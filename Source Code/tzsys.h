// =====================================================================
//  tzsys.h — shared system helpers: registry, shortcuts, processes,
//  folders, INI parsing (TopaZ Setup & TopaZ Creative Hub)
// =====================================================================
#pragma once
#include "tzui.h"
#include <shlobj.h>
#include <shobjidl.h>
#include <tlhelp32.h>
#include <map>

namespace tz {

inline std::wstring knownFolder(REFKNOWNFOLDERID id) {
    PWSTR p = nullptr; std::wstring r;
    if (SUCCEEDED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &p))) r = p;
    if (p) CoTaskMemFree(p);
    return r;
}
inline std::wstring userProgramsDir() {
    std::wstring p = knownFolder(FOLDERID_UserProgramFiles);
    if (p.empty()) { p = knownFolder(FOLDERID_LocalAppData); if (p.empty()) { wchar_t b[MAX_PATH]; ExpandEnvironmentStringsW(L"%LOCALAPPDATA%", b, MAX_PATH); p = b; } p += L"\\Programs"; }
    return p;
}
inline std::wstring exePath() { wchar_t b[MAX_PATH * 4]; GetModuleFileNameW(nullptr, b, MAX_PATH * 4); return b; }
inline std::wstring dirOf(const std::wstring& p) { size_t i = p.find_last_of(L"\\/"); return i == std::wstring::npos ? L"" : p.substr(0, i); }
inline std::wstring join(const std::wstring& a, const std::wstring& b) { if (a.empty()) return b; wchar_t c = a.back(); return (c == L'\\' || c == L'/') ? a + b : a + L"\\" + b; }
inline bool fileExists(const std::wstring& p) { DWORD a = GetFileAttributesW(p.c_str()); return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY); }
inline bool dirExists(const std::wstring& p) { DWORD a = GetFileAttributesW(p.c_str()); return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY); }
inline bool makeDirs(const std::wstring& p) { int r = SHCreateDirectoryExW(nullptr, p.c_str(), nullptr); return r == ERROR_SUCCESS || r == ERROR_ALREADY_EXISTS || r == ERROR_FILE_EXISTS; }
inline bool canWriteDir(const std::wstring& dir) {
    if (!makeDirs(dir)) return false;
    std::wstring t = join(dir, L".tz_write_test");
    HANDLE h = CreateFileW(t.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    CloseHandle(h); return true;
}
inline void deleteTree(const std::wstring& dir) {
    WIN32_FIND_DATAW fd; HANDLE h = FindFirstFileW(join(dir, L"*").c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            std::wstring n = fd.cFileName; if (n == L"." || n == L"..") continue;
            std::wstring p = join(dir, n);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) deleteTree(p);
            else { SetFileAttributesW(p.c_str(), FILE_ATTRIBUTE_NORMAL); if (!DeleteFileW(p.c_str())) MoveFileExW(p.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT); }
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    if (!RemoveDirectoryW(dir.c_str())) MoveFileExW(dir.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
}
inline unsigned long long dirSize(const std::wstring& dir) {
    unsigned long long s = 0; WIN32_FIND_DATAW fd; HANDLE h = FindFirstFileW(join(dir, L"*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return 0;
    do { std::wstring n = fd.cFileName; if (n == L"." || n == L"..") continue;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) s += dirSize(join(dir, n)); else s += ((unsigned long long)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
    } while (FindNextFileW(h, &fd));
    FindClose(h); return s;
}
inline unsigned long long freeSpace(const std::wstring& path) {
    std::wstring p = path; while (!p.empty() && !dirExists(p)) p = dirOf(p);
    ULARGE_INTEGER a; if (GetDiskFreeSpaceExW(p.empty() ? nullptr : p.c_str(), &a, nullptr, nullptr)) return a.QuadPart; return 0;
}

// ----- registry -----
inline void regSet(HKEY root, const std::wstring& key, const std::wstring& name, const std::wstring& val) {
    HKEY k; if (RegCreateKeyExW(root, key.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &k, nullptr) == ERROR_SUCCESS) {
        RegSetValueExW(k, name.empty() ? nullptr : name.c_str(), 0, REG_SZ, (const BYTE*)val.c_str(), (DWORD)((val.size() + 1) * sizeof(wchar_t))); RegCloseKey(k); }
}
inline void regSetDword(HKEY root, const std::wstring& key, const std::wstring& name, DWORD v) {
    HKEY k; if (RegCreateKeyExW(root, key.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &k, nullptr) == ERROR_SUCCESS) { RegSetValueExW(k, name.c_str(), 0, REG_DWORD, (const BYTE*)&v, 4); RegCloseKey(k); }
}
inline std::wstring regGet(HKEY root, const std::wstring& key, const std::wstring& name, const std::wstring& def = L"") {
    wchar_t buf[4096]; DWORD sz = sizeof(buf), type = 0;
    if (RegGetValueW(root, key.c_str(), name.empty() ? nullptr : name.c_str(), RRF_RT_REG_SZ, &type, buf, &sz) == ERROR_SUCCESS) return buf;
    return def;
}
inline DWORD regGetDword(HKEY root, const std::wstring& key, const std::wstring& name, DWORD def) {
    DWORD v = 0, sz = 4; if (RegGetValueW(root, key.c_str(), name.c_str(), RRF_RT_REG_DWORD, nullptr, &v, &sz) == ERROR_SUCCESS) return v; return def;
}
inline void regDeleteTree(HKEY root, const std::wstring& key) { RegDeleteTreeW(root, key.c_str()); RegDeleteKeyW(root, key.c_str()); }
inline void regDeleteValue(HKEY root, const std::wstring& key, const std::wstring& name) { HKEY k; if (RegOpenKeyExW(root, key.c_str(), 0, KEY_SET_VALUE, &k) == ERROR_SUCCESS) { RegDeleteValueW(k, name.c_str()); RegCloseKey(k); } }
inline std::vector<std::wstring> regSubkeys(HKEY root, const std::wstring& key) {
    std::vector<std::wstring> out; HKEY k;
    if (RegOpenKeyExW(root, key.c_str(), 0, KEY_READ, &k) != ERROR_SUCCESS) return out;
    wchar_t name[256]; for (DWORD i = 0;; i++) { DWORD n = 256; if (RegEnumKeyExW(k, i, name, &n, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break; out.push_back(name); }
    RegCloseKey(k); return out;
}

// ----- shortcuts -----
inline bool createShortcut(const std::wstring& lnk, const std::wstring& target, const std::wstring& args, const std::wstring& workdir, const std::wstring& desc, const std::wstring& icon) {
    IShellLinkW* sl = nullptr; bool ok = false;
    if (SUCCEEDED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_IShellLinkW, (void**)&sl))) {
        sl->SetPath(target.c_str()); sl->SetArguments(args.c_str()); sl->SetWorkingDirectory(workdir.c_str()); sl->SetDescription(desc.c_str());
        if (!icon.empty()) sl->SetIconLocation(icon.c_str(), 0);
        IPersistFile* pf = nullptr;
        if (SUCCEEDED(sl->QueryInterface(IID_IPersistFile, (void**)&pf))) { makeDirs(dirOf(lnk)); ok = SUCCEEDED(pf->Save(lnk.c_str(), TRUE)); pf->Release(); }
        sl->Release();
    }
    return ok;
}

// ----- processes -----
inline std::vector<DWORD> findProcesses(const std::wstring& exeName) {
    std::vector<DWORD> out; HANDLE s = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (s == INVALID_HANDLE_VALUE) return out;
    PROCESSENTRY32W pe; pe.dwSize = sizeof(pe);
    if (Process32FirstW(s, &pe)) do { if (_wcsicmp(pe.szExeFile, exeName.c_str()) == 0 && pe.th32ProcessID != GetCurrentProcessId()) out.push_back(pe.th32ProcessID); } while (Process32NextW(s, &pe));
    CloseHandle(s); return out;
}
inline void killProcesses(const std::wstring& exeName) {
    for (DWORD pid : findProcesses(exeName)) { HANDLE h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid); if (h) { TerminateProcess(h, 0); WaitForSingleObject(h, 5000); CloseHandle(h); } }
}
inline DWORD runAndWait(const std::wstring& exe, const std::wstring& args, bool elevate = false, HWND owner = nullptr) {
    SHELLEXECUTEINFOW sei = { sizeof(sei) };
    sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC; sei.hwnd = owner; sei.lpVerb = elevate ? L"runas" : L"open";
    sei.lpFile = exe.c_str(); sei.lpParameters = args.c_str(); sei.nShow = SW_SHOWNORMAL;
    if (!ShellExecuteExW(&sei) || !sei.hProcess) return (DWORD)-1;
    WaitForSingleObject(sei.hProcess, INFINITE);
    DWORD code = 0; GetExitCodeProcess(sei.hProcess, &code); CloseHandle(sei.hProcess); return code;
}
inline bool launch(const std::wstring& exe, const std::wstring& args = L"") {
    return (INT_PTR)ShellExecuteW(nullptr, L"open", exe.c_str(), args.empty() ? nullptr : args.c_str(), dirOf(exe).c_str(), SW_SHOWNORMAL) > 32;
}

// ----- ini (key=value) -----
inline std::map<std::wstring, std::wstring> parseIni(const std::string& utf8) {
    std::map<std::wstring, std::wstring> m; std::wstring t = utf8ToW(utf8); size_t i = 0;
    while (i < t.size()) {
        size_t e = t.find(L'\n', i); if (e == std::wstring::npos) e = t.size();
        std::wstring line = t.substr(i, e - i); i = e + 1;
        while (!line.empty() && (line.back() == L'\r' || line.back() == L' ')) line.pop_back();
        size_t eq = line.find(L'='); if (eq == std::wstring::npos || line[0] == L';' || line[0] == L'#') continue;
        m[line.substr(0, eq)] = line.substr(eq + 1);
    }
    return m;
}
inline std::wstring expandEnv(const std::wstring& s) { wchar_t b[4096]; ExpandEnvironmentStringsW(s.c_str(), b, 4096); return b; }

inline int versionCompare(const std::wstring& a, const std::wstring& b) {
    size_t i = 0, j = 0;
    while (i < a.size() || j < b.size()) {
        long x = 0, y = 0;
        while (i < a.size() && iswdigit(a[i])) x = x * 10 + (a[i++] - L'0');
        while (j < b.size() && iswdigit(b[j])) y = y * 10 + (b[j++] - L'0');
        if (x != y) return x < y ? -1 : 1;
        while (i < a.size() && !iswdigit(a[i])) i++;
        while (j < b.size() && !iswdigit(b[j])) j++;
    }
    return 0;
}
inline std::wstring pickFolder(HWND owner, const std::wstring& start, const std::wstring& title) {
    std::wstring res; IFileOpenDialog* d = nullptr;
    if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&d)))) {
        DWORD o; d->GetOptions(&o); d->SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM); d->SetTitle(title.c_str());
        IShellItem* si = nullptr; std::wstring s = start; while (!s.empty() && !dirExists(s)) s = dirOf(s);
        if (!s.empty() && SUCCEEDED(SHCreateItemFromParsingName(s.c_str(), nullptr, IID_PPV_ARGS(&si)))) { d->SetFolder(si); si->Release(); }
        if (SUCCEEDED(d->Show(owner))) { IShellItem* r = nullptr; if (SUCCEEDED(d->GetResult(&r))) { PWSTR p; if (SUCCEEDED(r->GetDisplayName(SIGDN_FILESYSPATH, &p))) { res = p; CoTaskMemFree(p); } r->Release(); } }
        d->Release();
    }
    return res;
}
inline std::wstring pickFile(HWND owner, const wchar_t* filterName, const wchar_t* filterSpec, const std::wstring& title) {
    std::wstring res; IFileOpenDialog* d = nullptr;
    if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&d)))) {
        COMDLG_FILTERSPEC f[1] = { { filterName, filterSpec } }; d->SetFileTypes(1, f); d->SetTitle(title.c_str());
        if (SUCCEEDED(d->Show(owner))) { IShellItem* r = nullptr; if (SUCCEEDED(d->GetResult(&r))) { PWSTR p; if (SUCCEEDED(r->GetDisplayName(SIGDN_FILESYSPATH, &p))) { res = p; CoTaskMemFree(p); } r->Release(); } }
        d->Release();
    }
    return res;
}
} // namespace tz
