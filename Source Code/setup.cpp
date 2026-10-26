// =====================================================================
//  TopaZ Setup — installer / uninstaller (C++ / Win32 / GDI+)
//  Payload: ZIP appended to the executable + 16-byte trailer
//           [uint64 payloadSize]["TZPAYLD1"]
//  Command line:
//     (none)                 graphical wizard
//     /S                     silent install     /D=<dir>  target folder
//     /NOHUB /NODESKTOP /NOASSOC /NOSTARTMENU    options
//     /uninstall [/S]        uninstall (run from the installed Uninstall.exe)
// =====================================================================
#include "../common/tzsys.h"
#include <dwmapi.h>
#include <commctrl.h>
#include <atomic>
#include <thread>
#include <cstdint>
#include "miniz.h"
#include "resource.h"

using namespace tz;
using namespace Gdiplus;

// ---------------------------------------------------------------- state
enum Page { P_WELCOME, P_LICENSE, P_OPTIONS, P_PROGRESS, P_FINISH, P_ERROR, P_UNCONFIRM, P_UNPROGRESS, P_UNDONE };
enum Ids { B_NEXT = 1, B_BACK, B_CLOSE, B_MIN, B_BROWSE, C_ACCEPT, C_DESKTOP, C_STARTMENU, C_ASSOC, C_HUB, C_LAUNCH, C_LAUNCHHUB, L_FOLDER };

static HWND g_hwnd = nullptr, g_edit = nullptr, g_lic = nullptr;
static HFONT g_font = nullptr;
static HBRUSH g_editBrush = nullptr;
static Page g_page = P_WELCOME;
static WidgetSet g_w;
static Bitmap *g_logo = nullptr, *g_logoSmall = nullptr;
static std::map<std::wstring, std::wstring> g_ini;
static std::wstring g_dir, g_hubDir, g_error;
static bool g_silent = false, g_optDesktop = true, g_optStart = true, g_optAssoc = true, g_optHub = true, g_uninstall = false, g_autostart = false;
static std::atomic<double> g_progress{ 0 };
static CRITICAL_SECTION g_cs;
static std::wstring g_status, g_curFile;
static uint64_t g_payloadOfs = 0, g_payloadSize = 0, g_requiredBytes = 0;
static int g_exitCode = 0;

static std::wstring ini(const std::wstring& k, const std::wstring& def = L"") { auto i = g_ini.find(k); return i == g_ini.end() ? def : i->second; }
static std::wstring appName() { return ini(L"AppName", L"TopaZ Editing Pro 26"); }
static bool hubOnly() { return ini(L"HubOnly") == L"1"; }   // standalone TopaZ Creative Hub installer
static void setStatus(const std::wstring& s, const std::wstring& f = L"") { EnterCriticalSection(&g_cs); g_status = s; g_curFile = f; LeaveCriticalSection(&g_cs); if (g_hwnd) PostMessageW(g_hwnd, WM_APP, 0, 0); }

// ---------------------------------------------------------------- payload
struct PayloadSrc { HANDLE h; uint64_t base; };
static size_t zipRead(void* op, mz_uint64 ofs, void* buf, size_t n) {
    auto* s = (PayloadSrc*)op; LARGE_INTEGER li; li.QuadPart = (LONGLONG)(s->base + ofs);
    if (!SetFilePointerEx(s->h, li, nullptr, FILE_BEGIN)) return 0;
    DWORD rd = 0; if (!ReadFile(s->h, buf, (DWORD)n, &rd, nullptr)) return 0; return rd;
}
static bool findPayload() {
    HANDLE h = CreateFileW(exePath().c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz; GetFileSizeEx(h, &sz);
    bool ok = false;
    if (sz.QuadPart > 16) {
        LARGE_INTEGER li; li.QuadPart = sz.QuadPart - 16; SetFilePointerEx(h, li, nullptr, FILE_BEGIN);
        uint8_t t[16]; DWORD rd = 0;
        if (ReadFile(h, t, 16, &rd, nullptr) && rd == 16 && memcmp(t + 8, "TZPAYLD1", 8) == 0) {
            memcpy(&g_payloadSize, t, 8);
            g_payloadOfs = (uint64_t)sz.QuadPart - 16 - g_payloadSize;
            ok = g_payloadSize > 0 && g_payloadOfs > 0;
        }
    }
    CloseHandle(h);
    return ok;
}
struct Zip {
    mz_zip_archive z{}; PayloadSrc src{}; bool ok = false;
    bool open() {
        src.h = CreateFileW(exePath().c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
        if (src.h == INVALID_HANDLE_VALUE) return false;
        src.base = g_payloadOfs; z.m_pRead = zipRead; z.m_pIO_opaque = &src;
        ok = mz_zip_reader_init(&z, g_payloadSize, 0) != 0; return ok;
    }
    ~Zip() { if (ok) mz_zip_reader_end(&z); if (src.h && src.h != INVALID_HANDLE_VALUE) CloseHandle(src.h); }
    std::string readText(const char* name) {
        int i = mz_zip_reader_locate_file(&z, name, nullptr, 0); if (i < 0) return "";
        size_t n = 0; void* p = mz_zip_reader_extract_to_heap(&z, i, &n, 0); if (!p) return "";
        std::string s((char*)p, n); mz_free(p); return s;
    }
};
static void loadIniFromPayload() {
    Zip z; if (!z.open()) return;
    g_ini = parseIni(z.readText("setup.ini"));
    mz_uint n = mz_zip_reader_get_num_files(&z.z); g_requiredBytes = 0;
    for (mz_uint i = 0; i < n; i++) { mz_zip_archive_file_stat st; if (mz_zip_reader_file_stat(&z.z, i, &st)) g_requiredBytes += st.m_uncomp_size; }
}

// ---------------------------------------------------------------- install
struct OutFile { HANDLE h; uint64_t* done; uint64_t total; };
static size_t writeCb(void* op, mz_uint64, const void* buf, size_t n) {
    auto* o = (OutFile*)op; DWORD wr = 0;
    if (!WriteFile(o->h, buf, (DWORD)n, &wr, nullptr)) return 0;
    *o->done += wr; g_progress = 0.05 + 0.85 * (double)*o->done / (double)(o->total ? o->total : 1);
    static DWORD last = 0; DWORD now = GetTickCount(); if (now - last > 40) { last = now; if (g_hwnd) PostMessageW(g_hwnd, WM_APP, 0, 0); }
    return wr;
}
static bool ensureClosed(const std::wstring& exe, const std::wstring& name) {
    while (!findProcesses(exe).empty()) {
        if (g_silent) { killProcesses(exe); Sleep(300); break; }
        int r = MessageBoxW(g_hwnd, (L"Program „" + name + L"” jest uruchomiony.\n\nZamknij go i kliknij „Ponów”, albo kliknij „Ignoruj”, aby zamknąć go automatycznie.").c_str(),
                            L"TopaZ Setup", MB_ABORTRETRYIGNORE | MB_ICONWARNING);
        if (r == IDABORT) return false;
        if (r == IDIGNORE) { killProcesses(exe); Sleep(300); break; }
    }
    return true;
}
static bool writeStub(const std::wstring& to) {
    HANDLE in = CreateFileW(exePath().c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (in == INVALID_HANDLE_VALUE) return false;
    HANDLE out = CreateFileW(to.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (out == INVALID_HANDLE_VALUE) { CloseHandle(in); return false; }
    uint64_t left = g_payloadOfs ? g_payloadOfs : (uint64_t)-1; std::vector<char> buf(1 << 20); bool ok = true;
    while (left > 0) { DWORD want = (DWORD)std::min<uint64_t>(left, buf.size()), rd = 0; if (!ReadFile(in, buf.data(), want, &rd, nullptr) || rd == 0) break; DWORD wr; if (!WriteFile(out, buf.data(), rd, &wr, nullptr)) { ok = false; break; } left -= rd; }
    CloseHandle(in); CloseHandle(out); return ok;
}
static void writeUninstallIni(const std::wstring& dir, const std::map<std::wstring, std::wstring>& extra) {
    std::wstring s;
    for (auto& kv : g_ini) if (!extra.count(kv.first)) s += kv.first + L"=" + kv.second + L"\r\n";
    for (auto& kv : extra) s += kv.first + L"=" + kv.second + L"\r\n";
    std::string u = "\xEF\xBB\xBF" + wToUtf8(s);
    HANDLE h = CreateFileW(join(dir, L"uninstall.ini").c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_HIDDEN, nullptr);
    if (h != INVALID_HANDLE_VALUE) { DWORD wr; WriteFile(h, u.data(), (DWORD)u.size(), &wr, nullptr); CloseHandle(h); }
}
static void registerApp(const std::wstring& id, const std::wstring& name, const std::wstring& version, const std::wstring& dir, const std::wstring& exe, unsigned long long bytes) {
    std::wstring un = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TopaZ_" + id;
    std::wstring exeFull = join(dir, exe), unExe = join(dir, L"Uninstall.exe");
    regSet(HKEY_CURRENT_USER, un, L"DisplayName", name);
    regSet(HKEY_CURRENT_USER, un, L"DisplayVersion", version);
    regSet(HKEY_CURRENT_USER, un, L"Publisher", ini(L"Publisher", L"TopaZ"));
    regSet(HKEY_CURRENT_USER, un, L"DisplayIcon", exeFull + L",0");
    regSet(HKEY_CURRENT_USER, un, L"InstallLocation", dir);
    regSet(HKEY_CURRENT_USER, un, L"UninstallString", L"\"" + unExe + L"\" /uninstall");
    regSet(HKEY_CURRENT_USER, un, L"QuietUninstallString", L"\"" + unExe + L"\" /uninstall /S");
    regSetDword(HKEY_CURRENT_USER, un, L"EstimatedSize", (DWORD)(bytes / 1024));
    regSetDword(HKEY_CURRENT_USER, un, L"NoModify", 1); regSetDword(HKEY_CURRENT_USER, un, L"NoRepair", 1);
    std::wstring ak = L"Software\\TopaZ\\Apps\\" + id;
    regSet(HKEY_CURRENT_USER, ak, L"Name", name); regSet(HKEY_CURRENT_USER, ak, L"Version", version);
    regSet(HKEY_CURRENT_USER, ak, L"InstallPath", dir); regSet(HKEY_CURRENT_USER, ak, L"MainExe", exe);
    regSet(HKEY_CURRENT_USER, ak, L"Uninstall", unExe);
}

static void installThread() {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    auto failWith = [](const std::wstring& m) { g_error = m; g_exitCode = 2; if (g_hwnd) PostMessageW(g_hwnd, WM_APP + 1, 0, 0); };
    setStatus(L"Przygotowywanie instalacji…");
    g_progress = 0.01;
    Zip z;
    if (!z.open()) { failWith(L"Pakiet instalacyjny jest uszkodzony lub niekompletny."); return; }
    std::wstring appId = ini(L"AppId", L"App"), mainExe = ini(L"MainExe"), version = ini(L"Version", L"1.0.0"), name = appName();
    std::wstring hubExe = ini(L"HubExe", L"TopaZ Creative Hub.exe");
    if (!ensureClosed(mainExe, name)) { failWith(L"Instalacja została przerwana."); return; }
    bool hubWasRunning = !findProcesses(hubExe).empty();
    // clean previous installation (only if it is ours)
    std::wstring prevIni = join(g_dir, L"uninstall.ini");
    if (fileExists(prevIni)) {
        setStatus(L"Usuwanie poprzedniej wersji…");
        HANDLE h = CreateFileW(prevIni.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
        std::string d; if (h != INVALID_HANDLE_VALUE) { char b[8192]; DWORD rd; while (ReadFile(h, b, sizeof b, &rd, nullptr) && rd) d.append(b, rd); CloseHandle(h); }
        if (d.size() >= 3 && (unsigned char)d[0] == 0xEF) d = d.substr(3);
        auto prev = parseIni(d);
        if (prev[L"AppId"] == appId) deleteTree(g_dir);
    }
    if (!makeDirs(g_dir)) { failWith(L"Nie można utworzyć folderu:\n" + g_dir); return; }
    bool doHub = g_optHub && ini(L"HasHub", L"1") == L"1";
    if (doHub) { killProcesses(hubExe); makeDirs(g_hubDir); }
    mz_uint n = mz_zip_reader_get_num_files(&z.z);
    uint64_t total = 0, done = 0;
    for (mz_uint i = 0; i < n; i++) { mz_zip_archive_file_stat st; mz_zip_reader_file_stat(&z.z, i, &st); std::string fn = st.m_filename; if (fn.rfind("app/", 0) == 0 || (doHub && fn.rfind("hub/", 0) == 0)) total += st.m_uncomp_size; }
    for (mz_uint i = 0; i < n; i++) {
        mz_zip_archive_file_stat st; if (!mz_zip_reader_file_stat(&z.z, i, &st)) continue;
        std::string fn = st.m_filename; std::wstring base;
        if (fn.rfind("app/", 0) == 0) { base = g_dir; fn = fn.substr(4); }
        else if (doHub && fn.rfind("hub/", 0) == 0) { base = g_hubDir; fn = fn.substr(4); }
        else continue;
        if (fn.empty()) continue;
        std::wstring rel = utf8ToW(fn); std::replace(rel.begin(), rel.end(), L'/', L'\\');
        if (rel.find(L"..") != std::wstring::npos) continue;
        std::wstring dst = join(base, rel);
        if (st.m_is_directory) { makeDirs(dst); continue; }
        makeDirs(dirOf(dst));
        setStatus(L"Kopiowanie plików…", rel);
        HANDLE h = CreateFileW(dst.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h == INVALID_HANDLE_VALUE) { failWith(L"Nie można zapisać pliku:\n" + dst + L"\n\nSprawdź uprawnienia lub zamknij uruchomione programy TopaZ."); return; }
        OutFile of{ h, &done, total };
        bool ok = mz_zip_reader_extract_to_callback(&z.z, i, writeCb, &of, 0) != 0;
        CloseHandle(h);
        if (!ok) { failWith(L"Błąd rozpakowywania pliku:\n" + rel); return; }
    }
    setStatus(L"Tworzenie skrótów i rejestrowanie programu…");
    g_progress = 0.92;
    std::wstring exeFull = join(g_dir, mainExe);
    std::wstring startDir = join(knownFolder(FOLDERID_Programs), L"TopaZ");
    std::wstring desktop = knownFolder(FOLDERID_Desktop);
    std::map<std::wstring, std::wstring> extra{ { L"InstallDir", g_dir } };
    int sc = 0;
    auto addShortcut = [&](const std::wstring& lnk, const std::wstring& target, const std::wstring& desc, std::map<std::wstring, std::wstring>& ex, int& cnt) {
        if (createShortcut(lnk, target, L"", dirOf(target), desc, target)) ex[L"Shortcut" + std::to_wstring(++cnt)] = lnk;
    };
    if (g_optStart) addShortcut(join(startDir, name + L".lnk"), exeFull, name, extra, sc);
    if (g_optDesktop) addShortcut(join(desktop, name + L".lnk"), exeFull, name, extra, sc);
    writeStub(join(g_dir, L"Uninstall.exe"));
    unsigned long long bytes = dirSize(g_dir);
    registerApp(appId, name, version, g_dir, mainExe, bytes);
    // file association
    std::wstring ext = ini(L"FileExt");
    if (g_optAssoc && !ext.empty()) {
        std::wstring prog = L"TopaZ." + appId + L".Project";
        regSet(HKEY_CURRENT_USER, L"Software\\Classes\\" + ext, L"", prog);
        regSet(HKEY_CURRENT_USER, L"Software\\Classes\\" + prog, L"", ini(L"FileDesc", L"Projekt TopaZ"));
        regSet(HKEY_CURRENT_USER, L"Software\\Classes\\" + prog + L"\\DefaultIcon", L"", exeFull + L",0");
        regSet(HKEY_CURRENT_USER, L"Software\\Classes\\" + prog + L"\\shell\\open\\command", L"", L"\"" + exeFull + L"\" \"%1\"");
        extra[L"ProgId"] = prog;
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
    }
    writeUninstallIni(g_dir, extra);
    if (hubOnly()) {   // standalone hub: remember where it lives and which app list it should use
        regSet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"InstallPath", g_dir);
        if (!ini(L"ManifestURL").empty() && regGet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"ManifestURL").empty())
            regSet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"ManifestURL", ini(L"ManifestURL"));
        if (ini(L"AutoStart") == L"1")
            regSet(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", L"TopaZ Creative Hub", L"\"" + exeFull + L"\" --minimized");
    }
    // hub registration
    if (doHub) {
        std::wstring hubFull = join(g_hubDir, hubExe);
        std::map<std::wstring, std::wstring> hx{ { L"InstallDir", g_hubDir }, { L"AppId", L"CreativeHub" }, { L"AppName", L"TopaZ Creative Hub" }, { L"MainExe", hubExe }, { L"FileExt", L"" }, { L"HasHub", L"0" } };
        int hsc = 0;
        addShortcut(join(startDir, L"TopaZ Creative Hub.lnk"), hubFull, L"TopaZ Creative Hub", hx, hsc);
        if (g_optDesktop) addShortcut(join(desktop, L"TopaZ Creative Hub.lnk"), hubFull, L"TopaZ Creative Hub", hx, hsc);
        writeStub(join(g_hubDir, L"Uninstall.exe"));
        writeUninstallIni(g_hubDir, hx);
        registerApp(L"CreativeHub", L"TopaZ Creative Hub", version, g_hubDir, hubExe, dirSize(g_hubDir));
        regSet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"InstallPath", g_hubDir);
        if (!ini(L"ManifestURL").empty() && regGet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"ManifestURL").empty())
            regSet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"ManifestURL", ini(L"ManifestURL"));
        if (hubWasRunning) launch(hubFull);
    }
    g_progress = 1.0;
    setStatus(L"Gotowe");
    if (g_hwnd) PostMessageW(g_hwnd, WM_APP + 2, 0, 0);
    CoUninitialize();
}

// ---------------------------------------------------------------- uninstall
static std::map<std::wstring, std::wstring> g_un;
static void uninstallThread() {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    std::wstring dir = g_dir, appId = g_un[L"AppId"], exe = g_un[L"MainExe"], name = g_un[L"AppName"];
    setStatus(L"Zamykanie programu…"); g_progress = 0.1;
    if (!ensureClosed(exe, name)) { g_error = L"Odinstalowywanie przerwane."; PostMessageW(g_hwnd, WM_APP + 1, 0, 0); return; }
    setStatus(L"Usuwanie skrótów…"); g_progress = 0.25;
    for (int i = 1; i < 20; i++) { auto it = g_un.find(L"Shortcut" + std::to_wstring(i)); if (it == g_un.end()) break; DeleteFileW(it->second.c_str()); }
    std::wstring startDir = join(knownFolder(FOLDERID_Programs), L"TopaZ"); RemoveDirectoryW(startDir.c_str());
    setStatus(L"Usuwanie wpisów rejestru…"); g_progress = 0.4;
    regDeleteTree(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TopaZ_" + appId);
    regDeleteTree(HKEY_CURRENT_USER, L"Software\\TopaZ\\Apps\\" + appId);
    if (appId == L"CreativeHub") { regDeleteValue(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"InstallPath"); regDeleteValue(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", L"TopaZ Creative Hub"); }
    if (!g_un[L"ProgId"].empty()) {
        std::wstring ext = g_un[L"FileExt"];
        if (!ext.empty() && regGet(HKEY_CURRENT_USER, L"Software\\Classes\\" + ext, L"") == g_un[L"ProgId"]) regDeleteTree(HKEY_CURRENT_USER, L"Software\\Classes\\" + ext);
        regDeleteTree(HKEY_CURRENT_USER, L"Software\\Classes\\" + g_un[L"ProgId"]);
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
    }
    setStatus(L"Usuwanie plików programu…"); g_progress = 0.6;
    if (!dir.empty() && fileExists(join(dir, L"uninstall.ini"))) deleteTree(dir);
    g_progress = 1.0; setStatus(L"Gotowe");
    PostMessageW(g_hwnd, WM_APP + 2, 0, 0);
    CoUninitialize();
}

// ---------------------------------------------------------------- UI
static const wchar_t* LICENSE_TEXT =
    L"UMOWA LICENCYJNA UŻYTKOWNIKA KOŃCOWEGO – TopaZ Editing Pro 26\r\n\r\n"
    L"1. Licencja. TopaZ udziela Ci niewyłącznej, nieprzenoszalnej licencji na instalowanie i używanie oprogramowania "
    L"TopaZ Editing Pro 26 oraz TopaZ Creative Hub (dalej „Oprogramowanie”) na Twoich urządzeniach.\r\n\r\n"
    L"2. Prawa autorskie. Oprogramowanie jest chronione prawem autorskim. Wszelkie prawa, które nie zostały wyraźnie "
    L"przyznane, są zastrzeżone.\r\n\r\n"
    L"3. Treści użytkownika. Projekty, filmy i inne materiały utworzone przy użyciu Oprogramowania należą do Ciebie. "
    L"Oprogramowanie nie przesyła Twoich plików multimedialnych do internetu.\r\n\r\n"
    L"4. Aktualizacje. TopaZ Creative Hub może łączyć się z adresem listy aplikacji ustawionym w programie, aby sprawdzać "
    L"i pobierać aktualizacje. Możesz zmienić ten adres lub wyłączyć automatyczne sprawdzanie w Ustawieniach.\r\n\r\n"
    L"5. Komponenty firm trzecich. Oprogramowanie zawiera komponenty open source (m.in. Chromium/Electron, miniz) "
    L"rozpowszechniane na ich własnych licencjach – patrz plik LICENSES w folderze instalacyjnym.\r\n\r\n"
    L"6. Brak gwarancji. Oprogramowanie jest dostarczane „tak jak jest”, bez jakichkolwiek gwarancji. W maksymalnym "
    L"zakresie dozwolonym przez prawo TopaZ nie ponosi odpowiedzialności za szkody wynikłe z używania Oprogramowania.\r\n\r\n"
    L"7. Postanowienia końcowe. Instalując Oprogramowanie, akceptujesz warunki niniejszej umowy.\r\n";

static void layout() {
    RECT rc; GetClientRect(g_hwnd, &rc); float W = (float)rc.right, H = (float)rc.bottom;
    g_w.hideAll();
    g_w.add(B_CLOSE, 4, L"✕", RectF(W - S(46), 0, S(46), S(36)));
    g_w.add(B_MIN, 4, L"—", RectF(W - S(92), 0, S(46), S(36)));
    RectF next(W - S(40) - S(150), H - S(64), S(150), S(38)), back(W - S(40) - S(150) - S(12) - S(120), H - S(64), S(120), S(38));
    ShowWindow(g_edit, SW_HIDE); ShowWindow(g_lic, SW_HIDE);
    switch (g_page) {
    case P_WELCOME: g_w.add(B_NEXT, 0, L"Dalej", next); break;
    case P_LICENSE: {
        g_w.add(B_BACK, 1, L"Wstecz", back);
        g_w.add(B_NEXT, 0, L"Dalej", next);
        g_w.add(C_ACCEPT, 2, L"Akceptuję warunki umowy licencyjnej", RectF(S(40), H - S(118), S(420), S(28)));
        g_w.get(B_NEXT)->enabled = g_w.get(C_ACCEPT)->checked;
        MoveWindow(g_lic, (int)S(52), (int)S(140), (int)(W - S(104)), (int)(H - S(140) - S(140)), TRUE); ShowWindow(g_lic, SW_SHOW);
        break; }
    case P_OPTIONS: {
        g_w.add(B_BACK, 1, L"Wstecz", back);
        g_w.add(B_NEXT, 0, L"Zainstaluj", next);
        g_w.get(B_NEXT)->enabled = true;
        g_w.add(B_BROWSE, 1, L"Przeglądaj…", RectF(W - S(40) - S(130), S(168), S(130), S(36)));
        MoveWindow(g_edit, (int)S(52), (int)S(176), (int)(W - S(40) - S(130) - S(24) - S(52)), (int)S(22), TRUE); ShowWindow(g_edit, SW_SHOW);
        float y = S(250);
        g_w.add(C_DESKTOP, 2, L"Utwórz skrót na pulpicie", RectF(S(40), y, S(400), S(28)), true); y += S(34);
        g_w.add(C_STARTMENU, 2, L"Dodaj do menu Start", RectF(S(40), y, S(400), S(28)), true); y += S(34);
        if (!ini(L"FileExt").empty()) { g_w.add(C_ASSOC, 2, L"Otwieraj pliki projektów (" + ini(L"FileExt") + L") w " + appName(), RectF(S(40), y, S(520), S(28)), true); y += S(34); }
        if (ini(L"HasHub", L"1") == L"1") g_w.add(C_HUB, 2, L"Zainstaluj TopaZ Creative Hub (aktualizacje i inne aplikacje) – zalecane", RectF(S(40), y, S(620), S(28)), true);
        break; }
    case P_FINISH:
        g_w.add(B_NEXT, 0, L"Zakończ", next);
        g_w.add(C_LAUNCH, 2, L"Uruchom " + appName(), RectF(S(260), S(300), S(420), S(28)), true);
        if (g_optHub && ini(L"HasHub", L"1") == L"1") g_w.add(C_LAUNCHHUB, 2, L"Uruchom TopaZ Creative Hub", RectF(S(260), S(334), S(420), S(28)), false);
        break;
    case P_ERROR: g_w.add(B_NEXT, 0, L"Zamknij", next); break;
    case P_UNCONFIRM: g_w.add(B_BACK, 1, L"Anuluj", back); g_w.add(B_NEXT, 0, L"Odinstaluj", next); break;
    case P_UNDONE: g_w.add(B_NEXT, 0, L"Zamknij", next); break;
    default: break;
    }
}

static void paint(HDC hdc) {
    RECT rc; GetClientRect(g_hwnd, &rc); int W = rc.right, H = rc.bottom;
    Bitmap buf(W, H, PixelFormat32bppARGB);
    Graphics g(&buf);
    g.SetSmoothingMode(SmoothingModeAntiAlias); g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit); g.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    SolidBrush bg(RGBc(col::bg)); g.FillRectangle(&bg, 0, 0, W, H);
    // header
    LinearGradientBrush hdr(PointF(0, 0), PointF((float)W, 0), RGBc(0x2a1356), RGBc(0x1b1b1b));
    g.FillRectangle(&hdr, 0.f, 0.f, (float)W, S(72));
    if (g_logoSmall) g.DrawImage(g_logoSmall, S(22), S(16), S(40), S(40));
    std::wstring title = g_uninstall ? (L"Odinstaluj – " + (g_un.count(L"AppName") ? g_un[L"AppName"] : appName())) : appName();
    text(g, title, RectF(S(72), S(14), W - S(72) - S(110), S(24)), 16, col::text, FontStyleBold);
    text(g, g_uninstall ? L"Deinstalator TopaZ" : (L"Instalator  ·  wersja " + ini(L"Version", L"26.0.0")), RectF(S(72), S(38), W - S(72) - S(470), S(20)), 12, col::text2);
    // step indicator
    if (!g_uninstall) {
        const wchar_t* steps[] = { L"Witaj", L"Licencja", L"Opcje", L"Instalacja", L"Gotowe" };
        int cur = g_page <= P_FINISH ? (int)g_page : 4;
        float sx = W - S(450);
        for (int i = 0; i < 5; i++) {
            float x = sx + i * S(84);
            fillRound(g, RectF(x, S(48), S(9), S(9)), S(4.5f), i < cur ? col::green : i == cur ? col::accent : 0x555555);
            text(g, steps[i], RectF(x + S(13), S(41), S(72), S(22)), 11.5f, i == cur ? col::text : col::text3);
        }
    }
    float cx = S(40), top = S(100);
    switch (g_page) {
    case P_WELCOME: {
        if (g_logo) g.DrawImage(g_logo, S(56), S(120), S(170), S(170));
        float x = S(270);
        text(g, L"Witaj w " + appName(), RectF(x, S(118), W - x - S(40), S(40)), 25, col::text, FontStyleBold);
        text(g, hubOnly() ? L"Ten kreator zainstaluje TopaZ Creative Hub – aplikację, z której pobierzesz, zainstalujesz i zaktualizujesz wszystkie programy TopaZ."
                          : L"Ten kreator zainstaluje na Twoim komputerze " + appName() + L" – profesjonalny edytor wideo – oraz aplikację TopaZ Creative Hub, która instaluje i aktualizuje programy TopaZ.",
             RectF(x, S(166), W - x - S(50), S(70)), 14, col::text2, FontStyleRegular, StringAlignmentNear, StringAlignmentNear, true);
        static const wchar_t* featsApp[] = { L"Montaż wielościeżkowy na osi czasu z przejściami i klatkami kluczowymi", L"90+ efektów GPU, korekcja kolorów Lumetri i zakresy",
                                             L"Szybki eksport sprzętowy H.264 / H.265 / AV1 do 8K", L"Tytuły, napisy i grafika animowana" };
        static const wchar_t* featsHub[] = { L"Instalowanie programów TopaZ jednym kliknięciem", L"Automatyczne powiadomienia o nowych wersjach",
                                             L"Aktualizacje z weryfikacją pliku (SHA-256)", L"Lista zmian „Co nowego” dla każdej wersji" };
        const wchar_t** feats = hubOnly() ? featsHub : featsApp;
        for (int i = 0; i < 4; i++) {
            float y = S(250) + i * S(30);
            fillRound(g, RectF(x, y + S(7), S(8), S(8)), S(4), col::purple);
            text(g, feats[i], RectF(x + S(20), y, W - x - S(60), S(22)), 13.5f, col::text);
        }
        text(g, L"Kliknij „Dalej”, aby kontynuować.", RectF(cx, H - S(58), S(400), S(24)), 12.5f, col::text3);
        break; }
    case P_LICENSE:
        text(g, L"Umowa licencyjna", RectF(cx, top, S(600), S(30)), 20, col::text, FontStyleBold);
        fillRound(g, RectF(S(40), S(132), W - S(80), H - S(132) - S(124)), S(8), 0x141414);
        strokeRound(g, RectF(S(40), S(132), W - S(80), H - S(132) - S(124)), S(8), col::line);
        break;
    case P_OPTIONS: {
        text(g, L"Opcje instalacji", RectF(cx, top, S(600), S(30)), 20, col::text, FontStyleBold);
        text(g, L"Folder instalacji", RectF(cx, S(140), S(300), S(22)), 13, col::text2);
        fillRound(g, RectF(S(40), S(168), W - S(40) - S(130) - S(52), S(36)), S(6), 0x141414);
        strokeRound(g, RectF(S(40), S(168), W - S(40) - S(130) - S(52), S(36)), S(6), 0x3a3a3a);
        wchar_t path[1024]; GetWindowTextW(g_edit, path, 1024);
        std::wstring info = L"Wymagane miejsce: " + fmtSize(g_requiredBytes) + L"   ·   Dostępne: " + fmtSize(freeSpace(path));
        text(g, info, RectF(cx, S(212), W - S(80), S(22)), 12, col::text3);
        break; }
    case P_PROGRESS: case P_UNPROGRESS: {
        text(g, g_page == P_PROGRESS ? (L"Instalowanie " + appName() + L"…") : L"Odinstalowywanie…", RectF(cx, top + S(40), W - S(80), S(34)), 22, col::text, FontStyleBold);
        EnterCriticalSection(&g_cs); std::wstring st = g_status, f = g_curFile; LeaveCriticalSection(&g_cs);
        text(g, st, RectF(cx, S(200), W - S(80), S(24)), 14, col::text2);
        double p = g_progress;
        progressBar(g, RectF(cx, S(240), W - S(80), S(10)), p);
        wchar_t pc[32]; swprintf(pc, 32, L"%d%%", (int)(p * 100 + 0.5));
        text(g, pc, RectF(W - S(140), S(260), S(100), S(22)), 13, col::text, FontStyleBold, StringAlignmentFar);
        text(g, f, RectF(cx, S(260), W - S(200), S(22)), 11.5f, col::text3);
        break; }
    case P_FINISH: {
        fillRound(g, RectF(S(80), S(130), S(120), S(120)), S(60), col::green);
        Pen pen(Color(255, 255, 255, 255), S(10)); pen.SetLineJoin(LineJoinRound); pen.SetStartCap(LineCapRound); pen.SetEndCap(LineCapRound);
        PointF pts[3] = { PointF(S(112), S(192)), PointF(S(132), S(212)), PointF(S(170), S(168)) }; g.DrawLines(&pen, pts, 3);
        text(g, L"Instalacja zakończona", RectF(S(260), S(130), W - S(300), S(36)), 24, col::text, FontStyleBold);
        text(g, appName() + L" został zainstalowany w folderze:", RectF(S(260), S(180), W - S(300), S(22)), 13.5f, col::text2);
        text(g, g_dir, RectF(S(260), S(206), W - S(300), S(22)), 13, col::text);
        if (g_optHub && ini(L"HasHub", L"1") == L"1") text(g, L"TopaZ Creative Hub będzie informować o nowych wersjach.", RectF(S(260), S(240), W - S(300), S(22)), 12.5f, col::text3);
        break; }
    case P_ERROR:
        fillRound(g, RectF(S(80), S(130), S(110), S(110)), S(55), col::red);
        text(g, L"!", RectF(S(80), S(130), S(110), S(110)), 60, 0xffffff, FontStyleBold, StringAlignmentCenter, StringAlignmentCenter);
        text(g, L"Wystąpił problem", RectF(S(240), S(130), W - S(280), S(36)), 24, col::text, FontStyleBold);
        text(g, g_error, RectF(S(240), S(176), W - S(280), S(160)), 13.5f, col::text2, FontStyleRegular, StringAlignmentNear, StringAlignmentNear, true);
        break;
    case P_UNCONFIRM:
        text(g, L"Czy na pewno odinstalować " + g_un[L"AppName"] + L"?", RectF(cx, top + S(30), W - S(80), S(34)), 21, col::text, FontStyleBold);
        text(g, L"Program zostanie usunięty z folderu:\n" + g_dir + L"\n\nTwoje projekty (.tzproj) i wyeksportowane filmy nie zostaną usunięte.", RectF(cx, S(180), W - S(80), S(120)), 13.5f, col::text2, FontStyleRegular, StringAlignmentNear, StringAlignmentNear, true);
        break;
    case P_UNDONE:
        text(g, g_un[L"AppName"] + L" został odinstalowany.", RectF(cx, top + S(60), W - S(80), S(34)), 21, col::text, FontStyleBold);
        break;
    }
    // footer line
    SolidBrush ln(RGBc(0x2a2a2a)); g.FillRectangle(&ln, 0.f, H - S(84), (float)W, 1.f);
    for (auto& w : g_w.w) drawWidget(g, w);
    Graphics(hdc).DrawImage(&buf, 0, 0);
}

static void finishAndClose() {
    if (g_page == P_FINISH) {
        if (g_w.get(C_LAUNCH) && g_w.get(C_LAUNCH)->checked) launch(join(g_dir, ini(L"MainExe")));
        if (g_w.get(C_LAUNCHHUB) && g_w.get(C_LAUNCHHUB)->visible && g_w.get(C_LAUNCHHUB)->checked) launch(join(g_hubDir, ini(L"HubExe", L"TopaZ Creative Hub.exe")));
    }
    DestroyWindow(g_hwnd);
}
static void go(Page p) { g_page = p; layout(); InvalidateRect(g_hwnd, nullptr, FALSE); }
static void startInstall() {
    wchar_t path[2048]; GetWindowTextW(g_edit, path, 2048); g_dir = path;
    while (!g_dir.empty() && (g_dir.back() == L'\\' || g_dir.back() == L'/')) g_dir.pop_back();
    if (g_dir.size() < 3) { MessageBoxW(g_hwnd, L"Podaj prawidłowy folder instalacji.", L"TopaZ Setup", MB_ICONWARNING); return; }
    g_optDesktop = g_w.get(C_DESKTOP)->checked; g_optStart = g_w.get(C_STARTMENU)->checked; g_optAssoc = g_w.get(C_ASSOC) ? g_w.get(C_ASSOC)->checked : false;
    g_optHub = g_w.get(C_HUB) ? g_w.get(C_HUB)->checked : false;
    if (freeSpace(g_dir) < g_requiredBytes + 20ull * 1024 * 1024) { MessageBoxW(g_hwnd, L"Za mało miejsca na dysku.", L"TopaZ Setup", MB_ICONERROR); return; }
    if (!canWriteDir(g_dir)) {
        // need administrator rights -> relaunch elevated
        std::wstring args = L"/autostart \"/D=" + g_dir + L"\"" + (g_optDesktop ? L"" : L" /NODESKTOP") + (g_optStart ? L"" : L" /NOSTARTMENU") + (g_optAssoc ? L"" : L" /NOASSOC") + (g_optHub ? L"" : L" /NOHUB");
        SHELLEXECUTEINFOW sei = { sizeof(sei) }; sei.lpVerb = L"runas"; std::wstring me = exePath(); sei.lpFile = me.c_str(); sei.lpParameters = args.c_str(); sei.nShow = SW_SHOWNORMAL; sei.hwnd = g_hwnd;
        if (ShellExecuteExW(&sei)) { DestroyWindow(g_hwnd); return; }
        MessageBoxW(g_hwnd, L"Do instalacji w tym folderze potrzebne są uprawnienia administratora.\nWybierz inny folder.", L"TopaZ Setup", MB_ICONWARNING);
        return;
    }
    go(P_PROGRESS);
    std::thread(installThread).detach();
}

static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
    switch (m) {
    case WM_CREATE: {
        g_hwnd = h; initDpi(h);
        g_font = CreateFontW(-(int)S(14), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
        g_editBrush = CreateSolidBrush(RGB(0x14, 0x14, 0x14));
        g_edit = CreateWindowExW(0, L"EDIT", g_dir.c_str(), WS_CHILD | ES_AUTOHSCROLL, 0, 0, 10, 10, h, (HMENU)L_FOLDER, nullptr, nullptr);
        g_lic = CreateWindowExW(0, L"EDIT", LICENSE_TEXT, WS_CHILD | ES_MULTILINE | ES_READONLY | WS_VSCROLL | ES_AUTOVSCROLL, 0, 0, 10, 10, h, nullptr, nullptr, nullptr);
        SendMessageW(g_edit, WM_SETFONT, (WPARAM)g_font, TRUE); SendMessageW(g_lic, WM_SETFONT, (WPARAM)g_font, TRUE);
        BOOL dark = TRUE; DwmSetWindowAttribute(h, 20, &dark, sizeof(dark));
        int corner = 2; DwmSetWindowAttribute(h, 33, &corner, sizeof(corner));
        layout();
        return 0; }
    case WM_CTLCOLOREDIT: case WM_CTLCOLORSTATIC: {
        HDC dc = (HDC)wp; SetTextColor(dc, RGB(0xe6, 0xe6, 0xe6)); SetBkColor(dc, RGB(0x14, 0x14, 0x14)); return (LRESULT)g_editBrush; }
    case WM_COMMAND: if (LOWORD(wp) == L_FOLDER && HIWORD(wp) == EN_CHANGE) InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: { PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); paint(dc); EndPaint(h, &ps); return 0; }
    case WM_NCHITTEST: {
        LRESULT r = DefWindowProcW(h, m, wp, lp);
        if (r == HTCLIENT) { POINT p = { GET_X_LPARAM(lp), GET_Y_LPARAM(lp) }; ScreenToClient(h, &p); if (p.y < S(72) && !g_w.hit((float)p.x, (float)p.y)) return HTCAPTION; }
        return r; }
    case WM_MOUSEMOVE: {
        float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp); Widget* w = g_w.hit(x, y); bool ch = false;
        for (auto& a : g_w.w) { bool hv = (&a == w); if (a.hover != hv) { a.hover = hv; ch = true; } }
        if (ch) InvalidateRect(h, nullptr, FALSE);
        TRACKMOUSEEVENT t = { sizeof(t), TME_LEAVE, h, 0 }; TrackMouseEvent(&t);
        SetCursor(LoadCursor(nullptr, w ? IDC_HAND : IDC_ARROW));
        return 0; }
    case WM_MOUSELEAVE: for (auto& a : g_w.w) a.hover = false; InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_SETCURSOR: if (LOWORD(lp) == HTCLIENT) return TRUE; break;
    case WM_LBUTTONUP: {
        Widget* w = g_w.hit((float)GET_X_LPARAM(lp), (float)GET_Y_LPARAM(lp)); if (!w) return 0;
        switch (w->id) {
        case B_CLOSE:
            if (g_page == P_PROGRESS || g_page == P_UNPROGRESS) return 0;
            if (g_page == P_FINISH || g_page == P_ERROR || g_page == P_UNDONE || MessageBoxW(h, L"Czy na pewno przerwać instalację?", L"TopaZ Setup", MB_YESNO | MB_ICONQUESTION) == IDYES) { if (g_page != P_FINISH && g_page != P_UNDONE) g_exitCode = 1; DestroyWindow(h); }
            return 0;
        case B_MIN: ShowWindow(h, SW_MINIMIZE); return 0;
        case C_ACCEPT: case C_DESKTOP: case C_STARTMENU: case C_ASSOC: case C_HUB: case C_LAUNCH: case C_LAUNCHHUB:
            w->checked = !w->checked; layout(); InvalidateRect(h, nullptr, FALSE); return 0;
        case B_BROWSE: {
            wchar_t cur[2048]; GetWindowTextW(g_edit, cur, 2048);
            std::wstring p = pickFolder(h, cur, L"Wybierz folder instalacji");
            if (!p.empty()) { std::wstring tail = L"\\" + ini(L"DirName", appName()); if (p.size() < tail.size() || _wcsicmp(p.c_str() + p.size() - tail.size(), tail.c_str()) != 0) p = join(p, ini(L"DirName", appName())); SetWindowTextW(g_edit, p.c_str()); }
            return 0; }
        case B_BACK:
            if (g_page == P_UNCONFIRM) { g_exitCode = 1; DestroyWindow(h); }
            else go((Page)(g_page - 1));
            return 0;
        case B_NEXT:
            switch (g_page) {
            case P_WELCOME: go(P_LICENSE); break;
            case P_LICENSE: go(P_OPTIONS); break;
            case P_OPTIONS: startInstall(); break;
            case P_FINISH: case P_ERROR: case P_UNDONE: finishAndClose(); break;
            case P_UNCONFIRM: go(P_UNPROGRESS); std::thread(uninstallThread).detach(); break;
            default: break;
            }
            return 0;
        }
        return 0; }
    case WM_APP: InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_APP + 1: go(P_ERROR); if (g_silent) DestroyWindow(h); return 0;
    case WM_APP + 2:
        if (g_uninstall) { go(P_UNDONE); if (g_silent) DestroyWindow(h); }
        else { go(P_FINISH); if (g_silent) DestroyWindow(h); }
        return 0;
    case WM_DPICHANGED: { initDpi(h); RECT* r = (RECT*)lp; SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER); DeleteObject(g_font);
        g_font = CreateFontW(-(int)S(14), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
        SendMessageW(g_edit, WM_SETFONT, (WPARAM)g_font, TRUE); SendMessageW(g_lic, WM_SETFONT, (WPARAM)g_font, TRUE); layout(); return 0; }
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(h, m, wp, lp);
}

// ---------------------------------------------------------------- entry
static std::wstring argValue(const std::vector<std::wstring>& a, const std::wstring& prefix) {
    for (auto& s : a) if (_wcsnicmp(s.c_str(), prefix.c_str(), prefix.size()) == 0) return s.substr(prefix.size());
    return L"";
}
static bool hasArg(const std::vector<std::wstring>& a, const wchar_t* f) { for (auto& s : a) if (_wcsicmp(s.c_str(), f) == 0) return true; return false; }

int WINAPI wWinMain(HINSTANCE hi, HINSTANCE, PWSTR, int) {
    setDpiAware();
    InitializeCriticalSection(&g_cs);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    GdiplusStartupInput gsi; ULONG_PTR gtok; GdiplusStartup(&gtok, &gsi, nullptr);
    int argc = 0; LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::vector<std::wstring> args; for (int i = 1; i < argc; i++) args.push_back(argv[i]);
    g_silent = hasArg(args, L"/S");
    g_autostart = hasArg(args, L"/autostart");
    g_optHub = !hasArg(args, L"/NOHUB"); g_optDesktop = !hasArg(args, L"/NODESKTOP"); g_optAssoc = !hasArg(args, L"/NOASSOC"); g_optStart = !hasArg(args, L"/NOSTARTMENU");
    g_logo = loadPng(IDR_LOGO); g_logoSmall = loadPng(IDR_LOGO);

    bool hasPayload = findPayload();
    if (hasArg(args, L"/uninstall")) {
        std::wstring target = argValue(args, L"/target=");
        if (target.empty()) {
            // running from install dir: copy to temp and relaunch so the folder can be deleted
            wchar_t tmp[MAX_PATH]; GetTempPathW(MAX_PATH, tmp);
            std::wstring copy = join(tmp, L"TopaZ_Uninstall_" + std::to_wstring(GetTickCount()) + L".exe");
            CopyFileW(exePath().c_str(), copy.c_str(), FALSE);
            std::wstring a = L"/uninstall \"/target=" + dirOf(exePath()) + L"\"" + (g_silent ? L" /S" : L"");
            if (g_silent) return (int)runAndWait(copy, a);
            launch(copy, a); return 0;
        }
        g_uninstall = true; g_dir = target;
        HANDLE fh = CreateFileW(join(target, L"uninstall.ini").c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
        std::string d; if (fh != INVALID_HANDLE_VALUE) { char b[8192]; DWORD rd; while (ReadFile(fh, b, sizeof b, &rd, nullptr) && rd) d.append(b, rd); CloseHandle(fh); }
        if (d.size() >= 3 && (unsigned char)d[0] == 0xEF) d = d.substr(3);
        g_un = parseIni(d);
        if (g_un.empty()) { if (!g_silent) MessageBoxW(nullptr, L"Nie znaleziono informacji o instalacji.", L"TopaZ", MB_ICONERROR); return 3; }
        g_page = g_silent ? P_UNPROGRESS : P_UNCONFIRM;
        // schedule self delete after exit
        std::wstring me = exePath();
        MoveFileExW(me.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
    } else {
        if (!hasPayload) { MessageBoxW(nullptr, L"Brak danych instalacyjnych. Pobierz pełny instalator TopaZ ponownie.", L"TopaZ Setup", MB_ICONERROR); return 3; }
        loadIniFromPayload();
        std::wstring def = join(userProgramsDir(), ini(L"DefaultDir", L"TopaZ\\" + appName()));
        std::wstring existing = regGet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Apps\\" + ini(L"AppId", L"App"), L"InstallPath");
        g_dir = argValue(args, L"/D=");
        if (g_dir.empty()) g_dir = existing.empty() ? def : existing;
        std::wstring hubExisting = regGet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Hub", L"InstallPath");
        g_hubDir = hubExisting.empty() ? join(userProgramsDir(), L"TopaZ\\TopaZ Creative Hub") : hubExisting;
        if (g_silent || g_autostart) g_page = P_PROGRESS;
    }

    WNDCLASSEXW wc = { sizeof(wc) }; wc.lpfnWndProc = WndProc; wc.hInstance = hi; wc.lpszClassName = L"TopaZSetupWnd";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW); wc.hIcon = LoadIconW(hi, MAKEINTRESOURCEW(1)); wc.hbrBackground = nullptr;
    RegisterClassExW(&wc);
    HDC sdc = GetDC(nullptr); float sc = GetDeviceCaps(sdc, LOGPIXELSX) / 96.0f; ReleaseDC(nullptr, sdc);
    int ww = (int)(800 * sc), wh = (int)(540 * sc);
    RECT wa; SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
    HWND h = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, (g_uninstall ? L"Odinstaluj TopaZ" : (L"Instalator " + appName()).c_str()),
                             WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN, (wa.left + wa.right - ww) / 2, (wa.top + wa.bottom - wh) / 2, ww, wh, nullptr, nullptr, hi, nullptr);
    if (!g_silent) ShowWindow(h, SW_SHOW);
    if (g_page == P_PROGRESS) { layout(); std::thread(installThread).detach(); }
    if (g_page == P_UNPROGRESS) { layout(); std::thread(uninstallThread).detach(); }
    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    if (g_uninstall) {
        // delete the temporary uninstaller copy shortly after exit
        std::wstring cmd = L"/c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + exePath() + L"\"";
        ShellExecuteW(nullptr, L"open", L"cmd.exe", cmd.c_str(), nullptr, SW_HIDE);
    }
    GdiplusShutdown(gtok);
    return g_exitCode;
}
