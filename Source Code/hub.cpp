// =====================================================================
//  TopaZ Creative Hub — app manager & updater for TopaZ applications
//  C++ / Win32 / GDI+ / WinHTTP / BCrypt
//
//  • lists TopaZ applications (installed ones from the registry and
//    available ones from an online manifest JSON)
//  • installs / updates (download + silent setup) / opens / uninstalls
//  • checks for updates automatically and shows a tray notification
//
//  Manifest format (manifest.json):
//  { "apps": [ { "id": "EditingPro26", "name": "TopaZ Editing Pro 26",
//      "version": "26.0.1", "description": "...", "notes": "...",
//      "installer": "https://.../TopaZ_Editing_Pro_26_Setup.exe",
//      "size": 140000000, "sha256": "..." } ] }
// =====================================================================
#include "../common/tzsys.h"
#include <dwmapi.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <mutex>
#include <thread>
#include <atomic>
#include <memory>
#include "resource.h"

using namespace tz;
using namespace Gdiplus;

static const wchar_t* HUB_VERSION = L"26.1.0";
static const wchar_t* REG_HUB = L"Software\\TopaZ\\Hub";

// ---------------------------------------------------------------- JSON
struct JVal {
    enum T { Null, Bool, Num, Str, Arr, Obj } t = Null;
    double n = 0; bool b = false; std::string s; std::vector<JVal> a; std::vector<std::pair<std::string, JVal>> o;
    const JVal* get(const char* k) const { for (auto& p : o) if (p.first == k) return &p.second; return nullptr; }
    std::wstring str(const char* k, const wchar_t* def = L"") const { auto v = get(k); if (!v) return def; if (v->t == Str) return utf8ToW(v->s); if (v->t == Num) { wchar_t b[64]; swprintf(b, 64, L"%.0f", v->n); return b; } return def; }
    double num(const char* k, double def = 0) const { auto v = get(k); return v && v->t == Num ? v->n : def; }
};
struct JParser {
    const std::string& s; size_t i = 0; bool err = false;
    explicit JParser(const std::string& src) : s(src) {}
    void ws() { while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++; }
    static void putUtf8(std::string& o, unsigned cp) {
        if (cp < 0x80) o += (char)cp; else if (cp < 0x800) { o += (char)(0xC0 | (cp >> 6)); o += (char)(0x80 | (cp & 63)); }
        else if (cp < 0x10000) { o += (char)(0xE0 | (cp >> 12)); o += (char)(0x80 | ((cp >> 6) & 63)); o += (char)(0x80 | (cp & 63)); }
        else { o += (char)(0xF0 | (cp >> 18)); o += (char)(0x80 | ((cp >> 12) & 63)); o += (char)(0x80 | ((cp >> 6) & 63)); o += (char)(0x80 | (cp & 63)); }
    }
    std::string str() {
        std::string o; i++;
        while (i < s.size() && s[i] != '"') {
            char c = s[i++];
            if (c == '\\' && i < s.size()) {
                char e = s[i++];
                switch (e) { case 'n': o += '\n'; break; case 't': o += '\t'; break; case 'r': o += '\r'; break; case 'b': o += '\b'; break; case 'f': o += '\f'; break;
                case 'u': { unsigned cp = (unsigned)strtoul(s.substr(i, 4).c_str(), nullptr, 16); i += 4;
                    if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') { unsigned lo = (unsigned)strtoul(s.substr(i + 2, 4).c_str(), nullptr, 16); i += 6; cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); }
                    putUtf8(o, cp); break; }
                default: o += e; }
            } else o += c;
        }
        i++; return o;
    }
    JVal val() {
        ws(); JVal v; if (i >= s.size()) { err = true; return v; }
        char c = s[i];
        if (c == '{') { v.t = JVal::Obj; i++; ws(); if (s[i] == '}') { i++; return v; }
            while (i < s.size()) { ws(); if (s[i] != '"') { err = true; return v; } std::string k = str(); ws(); if (s[i] != ':') { err = true; return v; } i++; v.o.push_back({ k, val() }); ws(); if (s[i] == ',') { i++; continue; } if (s[i] == '}') { i++; break; } err = true; return v; } }
        else if (c == '[') { v.t = JVal::Arr; i++; ws(); if (s[i] == ']') { i++; return v; }
            while (i < s.size()) { v.a.push_back(val()); ws(); if (s[i] == ',') { i++; continue; } if (s[i] == ']') { i++; break; } err = true; return v; } }
        else if (c == '"') { v.t = JVal::Str; v.s = str(); }
        else if (s.compare(i, 4, "true") == 0) { v.t = JVal::Bool; v.b = true; i += 4; }
        else if (s.compare(i, 5, "false") == 0) { v.t = JVal::Bool; i += 5; }
        else if (s.compare(i, 4, "null") == 0) { i += 4; }
        else { v.t = JVal::Num; char* e = nullptr; v.n = strtod(s.c_str() + i, &e); if (e == s.c_str() + i) err = true; i = e - s.c_str(); }
        return v;
    }
};

// ---------------------------------------------------------------- HTTP
using ProgressFn = std::function<bool(unsigned long long, unsigned long long)>;
static bool httpGet(const std::wstring& url, std::string* mem, const std::wstring& file, ProgressFn prog, std::wstring& err) {
    URL_COMPONENTS uc = { sizeof(uc) };
    wchar_t host[512], path[4096]; uc.lpszHostName = host; uc.dwHostNameLength = 512; uc.lpszUrlPath = path; uc.dwUrlPathLength = 4096;
    wchar_t extra[4096]; uc.lpszExtraInfo = extra; uc.dwExtraInfoLength = 4096;
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) { err = L"Nieprawidłowy adres URL"; return false; }
    std::wstring fullPath = std::wstring(path, uc.dwUrlPathLength) + std::wstring(extra, uc.dwExtraInfoLength);
    HINTERNET ses = WinHttpOpen(L"TopaZCreativeHub/26.0", 4 /*WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY*/, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) ses = WinHttpOpen(L"TopaZCreativeHub/26.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) { err = L"Brak dostępu do sieci"; return false; }
    DWORD proto = 0x00000800 | 0x00002000; // TLS1.2 | TLS1.3
    WinHttpSetOption(ses, WINHTTP_OPTION_SECURE_PROTOCOLS, &proto, sizeof(proto));
    WinHttpSetTimeouts(ses, 15000, 15000, 30000, 60000);
    HINTERNET con = WinHttpConnect(ses, std::wstring(host, uc.dwHostNameLength).c_str(), uc.nPort, 0);
    HINTERNET req = con ? WinHttpOpenRequest(con, L"GET", fullPath.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0) : nullptr;
    bool ok = false; HANDLE fh = INVALID_HANDLE_VALUE;
    if (req && WinHttpSendRequest(req, L"Cache-Control: no-cache\r\n", (DWORD)-1L, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) && WinHttpReceiveResponse(req, nullptr)) {
        DWORD status = 0, sz = sizeof(status);
        WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
        if (status != 200) { err = L"Serwer zwrócił błąd HTTP " + std::to_wstring(status); }
        else {
            wchar_t clen[64]; DWORD cl = sizeof(clen); unsigned long long total = 0;
            if (WinHttpQueryHeaders(req, WINHTTP_QUERY_CONTENT_LENGTH, WINHTTP_HEADER_NAME_BY_INDEX, clen, &cl, WINHTTP_NO_HEADER_INDEX)) total = _wcstoui64(clen, nullptr, 10);
            if (!file.empty()) { makeDirs(dirOf(file)); fh = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr); if (fh == INVALID_HANDLE_VALUE) err = L"Nie można zapisać pliku tymczasowego"; }
            if (file.empty() || fh != INVALID_HANDLE_VALUE) {
                std::vector<char> buf(256 * 1024); unsigned long long done = 0; ok = true;
                for (;;) {
                    DWORD rd = 0;
                    if (!WinHttpReadData(req, buf.data(), (DWORD)buf.size(), &rd)) { err = L"Przerwano połączenie"; ok = false; break; }
                    if (rd == 0) break;
                    if (mem) mem->append(buf.data(), rd);
                    if (fh != INVALID_HANDLE_VALUE) { DWORD wr; if (!WriteFile(fh, buf.data(), rd, &wr, nullptr)) { err = L"Błąd zapisu na dysku"; ok = false; break; } }
                    done += rd;
                    if (prog && !prog(done, total)) { err = L"Anulowano"; ok = false; break; }
                }
                if (ok && total && done != total) { ok = false; err = L"Pobrano niekompletny plik"; }
            }
        }
    } else if (err.empty()) {
        DWORD e = GetLastError();
        err = e == 12007 ? L"Nie można odnaleźć serwera (brak internetu?)" : e == 12029 ? L"Nie można połączyć się z serwerem" : e == 12002 ? L"Przekroczono czas połączenia" : (L"Błąd sieci " + std::to_wstring(e));
    }
    if (fh != INVALID_HANDLE_VALUE) { CloseHandle(fh); if (!ok) DeleteFileW(file.c_str()); }
    if (req) WinHttpCloseHandle(req); if (con) WinHttpCloseHandle(con); WinHttpCloseHandle(ses);
    return ok;
}
static std::wstring sha256File(const std::wstring& p) {
    BCRYPT_ALG_HANDLE alg = nullptr; BCRYPT_HASH_HANDLE hh = nullptr; std::wstring out;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return out;
    if (BCryptCreateHash(alg, &hh, nullptr, 0, nullptr, 0, 0) == 0) {
        HANDLE f = CreateFileW(p.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
        if (f != INVALID_HANDLE_VALUE) {
            std::vector<BYTE> b(1 << 20); DWORD rd;
            while (ReadFile(f, b.data(), (DWORD)b.size(), &rd, nullptr) && rd) BCryptHashData(hh, b.data(), rd, 0);
            CloseHandle(f);
            BYTE d[32]; if (BCryptFinishHash(hh, d, 32, 0) == 0) { wchar_t x[3]; for (BYTE c : d) { swprintf(x, 3, L"%02x", c); out += x; } }
        }
        BCryptDestroyHash(hh);
    }
    BCryptCloseAlgorithmProvider(alg, 0);
    return out;
}

// ---------------------------------------------------------------- model
struct App {
    std::wstring id, name, desc, notes, installed, path, exe, uninst, latest, url, sha;
    unsigned long long size = 0; int icon = IDR_LOGO_HUB;
    std::atomic<int> phase{ 0 };       // 0 idle, 1 downloading, 2 installing, 3 uninstalling
    std::atomic<double> prog{ 0 };
    std::atomic<bool> cancel{ false };
    std::wstring busyText;
    bool isInstalled() const { return !installed.empty() && fileExists(join(path, exe)); }
    bool hasUpdate() const { return isInstalled() && !latest.empty() && versionCompare(latest, installed) > 0; }
};
static std::vector<std::unique_ptr<App>> g_apps;
static std::recursive_mutex g_mx;
static HWND g_hwnd = nullptr, g_urlEdit = nullptr;
static HFONT g_font = nullptr; static HBRUSH g_editBrush = nullptr;
static Bitmap *g_logoHub = nullptr, *g_logoEd = nullptr;
static WidgetSet g_w;
static int g_page = 0; // 0 apps, 1 updates, 2 settings, 3 about
static std::wstring g_statusMsg = L"", g_lastCheck;
static bool g_statusErr = false, g_checking = false;
static NOTIFYICONDATAW g_nid = {};
static int g_hoverCard = -1;

enum { N_APPS = 1, N_UPD, N_SET, N_ABOUT, B_CHECK, B_FROMFILE, B_SAVEURL, C_AUTOSTART, C_AUTOCHECK, B_HELP, CARD_BASE = 1000 };

static App* findApp(const std::wstring& id) { for (auto& a : g_apps) if (a->id == id) return a.get(); return nullptr; }
static App* ensureApp(const std::wstring& id) {
    App* a = findApp(id); if (a) return a;
    g_apps.push_back(std::make_unique<App>()); a = g_apps.back().get(); a->id = id; return a;
}
static void loadCatalog() {
    std::lock_guard<std::recursive_mutex> lk(g_mx);
    App* ed = ensureApp(L"EditingPro26");
    if (ed->name.empty()) ed->name = L"TopaZ Editing Pro 26";
    if (ed->desc.empty()) ed->desc = L"Profesjonalny montaż wideo: oś czasu, efekty GPU, korekcja kolorów Lumetri i eksport H.264.";
    ed->icon = IDR_LOGO_ED;
    for (auto& id : regSubkeys(HKEY_CURRENT_USER, L"Software\\TopaZ\\Apps")) {
        if (id == L"CreativeHub") continue;
        std::wstring k = L"Software\\TopaZ\\Apps\\" + id;
        App* a = ensureApp(id);
        a->installed = regGet(HKEY_CURRENT_USER, k, L"Version");
        a->path = regGet(HKEY_CURRENT_USER, k, L"InstallPath");
        a->exe = regGet(HKEY_CURRENT_USER, k, L"MainExe");
        a->uninst = regGet(HKEY_CURRENT_USER, k, L"Uninstall");
        std::wstring n = regGet(HKEY_CURRENT_USER, k, L"Name"); if (!n.empty()) a->name = n;
    }
    for (auto& a : g_apps) if (!regGet(HKEY_CURRENT_USER, L"Software\\TopaZ\\Apps\\" + a->id, L"Version").size()) { a->installed.clear(); }
}
static int updatesCount() { int n = 0; for (auto& a : g_apps) if (a->hasUpdate()) n++; return n; }
#ifndef TZ_DEFAULT_MANIFEST
#define TZ_DEFAULT_MANIFEST L"https://raw.githubusercontent.com/TopaZ-Hub/TopaZ-Editing-Pro/main/manifest.json"
#endif
// The address saved in Settings wins; otherwise the built-in TopaZ app list is used.
static std::wstring manifestUrl() { std::wstring u = regGet(HKEY_CURRENT_USER, REG_HUB, L"ManifestURL"); return u.empty() ? std::wstring(TZ_DEFAULT_MANIFEST) : u; }

static void notify(const std::wstring& title, const std::wstring& msg) {
    g_nid.uFlags = NIF_INFO; wcsncpy(g_nid.szInfoTitle, title.c_str(), 63); wcsncpy(g_nid.szInfo, msg.c_str(), 255); g_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}
static void setStatus(const std::wstring& s, bool err = false) { g_statusMsg = s; g_statusErr = err; if (g_hwnd) PostMessageW(g_hwnd, WM_APP, 0, 0); }

// Fetches manifest.json and refreshes the app list. A cache-busting query is
// appended so CDN copies (e.g. raw.githubusercontent.com, ~5 min cache) are skipped.
static bool fetchManifest(const std::wstring& url, std::wstring& err) {
    std::wstring u = url + (url.find(L'?') == std::wstring::npos ? L"?t=" : L"&t=") + std::to_wstring(GetTickCount64());
    std::string body;
    if (!httpGet(u, &body, L"", nullptr, err) && !httpGet(url, &body, L"", nullptr, err)) return false;
    if (body.size() >= 3 && (unsigned char)body[0] == 0xEF) body = body.substr(3);
    JParser p(body); JVal root = p.val();
    const JVal* arr = root.get("apps");
    if (p.err || !arr || arr->t != JVal::Arr) { err = L"Nieprawidłowy format listy aplikacji (manifest.json)"; return false; }
    std::lock_guard<std::recursive_mutex> lk(g_mx);
    for (auto& j : arr->a) {
        std::wstring id = j.str("id"); if (id.empty() || id == L"CreativeHub") continue;
        App* a = ensureApp(id);
        std::wstring n = j.str("name"); if (!n.empty()) a->name = n;
        std::wstring d = j.str("description"); if (!d.empty()) a->desc = d;
        a->latest = j.str("version"); a->url = j.str("installer"); a->sha = j.str("sha256"); a->notes = j.str("notes");
        a->size = (unsigned long long)j.num("size");
        if (id == L"EditingPro26") a->icon = IDR_LOGO_ED;
    }
    return true;
}

static void checkUpdates(bool userInitiated) {
    if (g_checking) return;
    std::wstring url = manifestUrl();
    if (url.empty()) { if (userInitiated) setStatus(L"Nie ustawiono adresu listy aplikacji – przejdź do Ustawień.", true); return; }
    g_checking = true; setStatus(L"Sprawdzanie dostępnych aktualizacji…");
    std::thread([url, userInitiated]() {
        std::wstring err;
        bool ok = fetchManifest(url, err);
        SYSTEMTIME st; GetLocalTime(&st); wchar_t t[64]; swprintf(t, 64, L"%02d:%02d", st.wHour, st.wMinute); g_lastCheck = t;
        g_checking = false;
        if (!ok) setStatus(L"Nie można pobrać listy aplikacji: " + err, true);
        else {
            int n = updatesCount();
            setStatus(n ? (L"Dostępne aktualizacje: " + std::to_wstring(n)) : L"Wszystkie aplikacje są aktualne");
            if (n && !userInitiated) { std::lock_guard<std::recursive_mutex> lk(g_mx); for (auto& a : g_apps) if (a->hasUpdate()) { notify(L"Dostępna aktualizacja", a->name + L" " + a->latest); break; } }
        }
        PostMessageW(g_hwnd, WM_APP + 1, 0, 0);
    }).detach();
}

static void runInstall(App* a) {
    if (a->phase) return;
    if (a->url.empty()) { MessageBoxW(g_hwnd, L"Brak adresu instalatora dla tej aplikacji. Sprawdź listę aplikacji w Ustawieniach.", L"TopaZ Creative Hub", MB_ICONWARNING); return; }
    if (a->isInstalled() && !findProcesses(a->exe).empty()) {
        if (MessageBoxW(g_hwnd, (a->name + L" jest uruchomiony. Zamknąć program, aby zainstalować aktualizację?\n\nZapisz najpierw swoją pracę!").c_str(), L"TopaZ Creative Hub", MB_OKCANCEL | MB_ICONWARNING) != IDOK) return;
    }
    a->phase = 1; a->prog = 0; a->cancel = false; a->busyText = L"Łączenie…";
    InvalidateRect(g_hwnd, nullptr, FALSE);
    std::thread([a]() {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        { std::wstring e2, mu = manifestUrl(); if (!mu.empty()) fetchManifest(mu, e2); }   // always use the newest installer URL + checksum
        wchar_t tmp[MAX_PATH]; GetTempPathW(MAX_PATH, tmp);
        std::wstring file = join(join(tmp, L"TopaZ"), a->id + L"-" + (a->latest.empty() ? L"setup" : a->latest) + L"-Setup.exe");
        std::wstring err;
        bool ok = httpGet(a->url, nullptr, file, [a](unsigned long long d, unsigned long long t) {
            unsigned long long tot = t ? t : a->size;
            a->prog = tot ? (double)d / tot : 0;
            wchar_t b[128]; swprintf(b, 128, L"Pobieranie… %s / %s", fmtSize(d).c_str(), tot ? fmtSize(tot).c_str() : L"?");
            { std::lock_guard<std::recursive_mutex> lk(g_mx); a->busyText = b; }
            static DWORD last = 0; DWORD now = GetTickCount(); if (now - last > 80) { last = now; PostMessageW(g_hwnd, WM_APP, 0, 0); }
            return !a->cancel.load();
        }, err);
        if (ok && !a->sha.empty()) {
            { std::lock_guard<std::recursive_mutex> lk(g_mx); a->busyText = L"Weryfikowanie pliku…"; } PostMessageW(g_hwnd, WM_APP, 0, 0);
            std::wstring h = sha256File(file);
            if (_wcsicmp(h.c_str(), a->sha.c_str()) != 0) {   // manifest may have been updated meanwhile – re-check once
                std::wstring e2, mu = manifestUrl(); if (!mu.empty()) fetchManifest(mu, e2);
            }
            if (_wcsicmp(h.c_str(), a->sha.c_str()) != 0) { ok = false; err = L"Suma kontrolna pliku się nie zgadza (plik uszkodzony)"; DeleteFileW(file.c_str()); }
        }
        if (ok) {
            a->phase = 2; { std::lock_guard<std::recursive_mutex> lk(g_mx); a->busyText = L"Instalowanie…"; } a->prog = 1; PostMessageW(g_hwnd, WM_APP + 1, 0, 0);
            std::wstring args = L"/S /NOHUB";
            if (a->isInstalled()) args += L" \"/D=" + a->path + L"\"";
            DWORD code = runAndWait(file, args);
            DeleteFileW(file.c_str());
            if (code != 0) { ok = false; err = code == (DWORD)-1 ? L"Nie można uruchomić instalatora" : L"Instalator zakończył się błędem (kod " + std::to_wstring(code) + L")"; }
        }
        a->phase = 0;
        loadCatalog();
        if (ok) { setStatus(a->name + L" – zainstalowano wersję " + a->installed); notify(L"Instalacja zakończona", a->name + L" " + a->installed); }
        else setStatus(a->name + L": " + err, true);
        PostMessageW(g_hwnd, WM_APP + 1, 0, 0);
        CoUninitialize();
    }).detach();
}
static void runUninstall(App* a) {
    if (a->phase || !a->isInstalled()) return;
    if (MessageBoxW(g_hwnd, (L"Odinstalować " + a->name + L"?\n\nTwoje projekty i filmy nie zostaną usunięte.").c_str(), L"TopaZ Creative Hub", MB_YESNO | MB_ICONQUESTION) != IDYES) return;
    a->phase = 3; a->busyText = L"Odinstalowywanie…"; a->prog = 0.5; InvalidateRect(g_hwnd, nullptr, FALSE);
    std::thread([a]() {
        DWORD code = runAndWait(a->uninst, L"/uninstall /S");
        a->phase = 0; loadCatalog();
        setStatus(code == 0 ? a->name + L" został odinstalowany" : a->name + L": błąd odinstalowywania", code != 0);
        PostMessageW(g_hwnd, WM_APP + 1, 0, 0);
    }).detach();
}

// ---------------------------------------------------------------- UI
static std::vector<App*> visibleApps() {
    std::vector<App*> v; for (auto& a : g_apps) if (g_page == 0 || (g_page == 1 && a->hasUpdate())) v.push_back(a.get()); return v;
}
static RectF cardRect(int i, float W) { float x = S(260), y = S(150) + i * S(112); return RectF(x, y, W - x - S(30), S(98)); }

static void layout() {
    RECT rc; GetClientRect(g_hwnd, &rc); float W = (float)rc.right, H = (float)rc.bottom;
    g_w.hideAll();
    g_w.add(N_APPS, 5, L"Wszystkie aplikacje", RectF(S(12), S(96), S(206), S(38)));
    g_w.add(N_UPD, 5, L"Aktualizacje", RectF(S(12), S(138), S(206), S(38)));
    g_w.add(N_SET, 5, L"Ustawienia", RectF(S(12), S(180), S(206), S(38)));
    g_w.add(N_ABOUT, 5, L"Informacje", RectF(S(12), S(222), S(206), S(38)));
    ShowWindow(g_urlEdit, SW_HIDE);
    if (g_page <= 1) {
        g_w.add(B_CHECK, 1, g_checking ? L"Sprawdzanie…" : L"Sprawdź aktualizacje", RectF(W - S(30) - S(190), S(34), S(190), S(36)));
        g_w.add(B_FROMFILE, 1, L"Zainstaluj z pliku…", RectF(W - S(30) - S(190) - S(12) - S(180), S(34), S(180), S(36)));
        auto apps = visibleApps();
        for (int i = 0; i < (int)apps.size(); i++) {
            App* a = apps[i]; RectF c = cardRect(i, W); int base = CARD_BASE + i * 10;
            float bx = c.X + c.Width - S(20);
            RectF more(bx - S(36), c.Y + S(31), S(36), S(36)); bx -= S(36) + S(10);
            if (a->phase == 1) { g_w.add(base + 3, 1, L"Anuluj", RectF(bx - S(110), c.Y + S(31), S(110), S(36))); continue; }
            if (a->phase) continue;
            if (a->isInstalled()) {
                g_w.add(base + 2, 4, L"⋯", more);
                if (a->hasUpdate()) { g_w.add(base + 0, 0, L"Aktualizuj", RectF(bx - S(130), c.Y + S(31), S(130), S(36))); bx -= S(140); g_w.add(base + 1, 1, L"Otwórz", RectF(bx - S(110), c.Y + S(31), S(110), S(36))); }
                else g_w.add(base + 1, 0, L"Otwórz", RectF(bx - S(110), c.Y + S(31), S(110), S(36)));
            } else {
                g_w.add(base + 0, 0, L"Zainstaluj", RectF(bx - S(130), c.Y + S(31), S(130), S(36)));
                g_w.get(base + 0)->enabled = !a->url.empty();
            }
        }
    } else if (g_page == 2) {
        MoveWindow(g_urlEdit, (int)S(272), (int)S(167), (int)(W - S(272) - S(30) - S(120) - S(24)), (int)S(22), TRUE); ShowWindow(g_urlEdit, SW_SHOW);
        g_w.add(B_SAVEURL, 0, L"Zapisz", RectF(W - S(30) - S(120), S(160), S(120), S(36)));
        bool autostart = !regGet(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", L"TopaZ Creative Hub").empty();
        g_w.add(C_AUTOSTART, 2, L"Uruchamiaj TopaZ Creative Hub razem z systemem Windows", RectF(S(260), S(236), S(520), S(28)));
        g_w.get(C_AUTOSTART)->checked = autostart;
        g_w.add(C_AUTOCHECK, 2, L"Automatycznie sprawdzaj aktualizacje (co 6 godzin)", RectF(S(260), S(270), S(520), S(28)));
        g_w.get(C_AUTOCHECK)->checked = regGetDword(HKEY_CURRENT_USER, REG_HUB, L"AutoCheck", 1) != 0;
        g_w.add(B_CHECK, 1, L"Sprawdź teraz", RectF(S(260), S(316), S(160), S(36)));
        g_w.add(B_FROMFILE, 1, L"Zainstaluj z pliku…", RectF(S(432), S(316), S(180), S(36)));
    }
}

static void drawIcon(Graphics& g, int res, RectF r) {
    Bitmap* b = res == IDR_LOGO_ED ? g_logoEd : g_logoHub;
    if (b) g.DrawImage(b, r);
}
static void paint(HDC hdc) {
    RECT rc; GetClientRect(g_hwnd, &rc); int W = rc.right, H = rc.bottom; if (W <= 0 || H <= 0) return;
    Bitmap buf(W, H, PixelFormat32bppARGB); Graphics g(&buf);
    g.SetSmoothingMode(SmoothingModeAntiAlias); g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit); g.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    SolidBrush bg(RGBc(col::bg)); g.FillRectangle(&bg, 0, 0, W, H);
    // sidebar
    SolidBrush sb(RGBc(0x141414)); g.FillRectangle(&sb, 0.f, 0.f, S(230), (float)H);
    if (g_logoHub) g.DrawImage(g_logoHub, S(18), S(22), S(40), S(40));
    text(g, L"TopaZ", RectF(S(68), S(20), S(150), S(22)), 15, col::text, FontStyleBold);
    text(g, L"Creative Hub", RectF(S(68), S(40), S(150), S(22)), 13, col::text2);
    for (auto& w : g_w.w) {
        if (!w.visible || w.kind != 5) continue;
        bool sel = (w.id == N_APPS && g_page == 0) || (w.id == N_UPD && g_page == 1) || (w.id == N_SET && g_page == 2) || (w.id == N_ABOUT && g_page == 3);
        if (sel || w.hover) fillRound(g, w.r, S(6), sel ? 0x2d3f5c : 0x242424);
        text(g, w.label, RectF(w.r.X + S(14), w.r.Y, w.r.Width - S(50), w.r.Height), 13.5f, sel ? 0xffffff : col::text);
        if (w.id == N_UPD) { int n = updatesCount(); if (n) { RectF bdg(w.r.X + w.r.Width - S(34), w.r.Y + S(9), S(24), S(20)); fillRound(g, bdg, S(10), col::orange); text(g, std::to_wstring(n), bdg, 11.5f, 0xffffff, FontStyleBold, StringAlignmentCenter); } }
    }
    text(g, std::wstring(L"Wersja ") + HUB_VERSION, RectF(S(18), H - S(40), S(200), S(22)), 11.5f, col::text3);
    // main
    float x0 = S(260);
    const wchar_t* titles[] = { L"Wszystkie aplikacje", L"Aktualizacje", L"Ustawienia", L"Informacje" };
    text(g, titles[g_page], RectF(x0, S(30), S(500), S(40)), 24, col::text, FontStyleBold);
    if (g_page <= 1) {
        std::wstring st = g_statusMsg.empty() ? (g_lastCheck.empty() ? (manifestUrl().empty() ? std::wstring(L"Aby otrzymywać aktualizacje, ustaw adres listy aplikacji w Ustawieniach.") : std::wstring()) : L"Ostatnio sprawdzono: " + g_lastCheck) : g_statusMsg;
        if (!st.empty()) text(g, st, RectF(x0, S(84), W - x0 - S(30), S(40)), 13, g_statusErr ? col::red : col::text2, FontStyleRegular, StringAlignmentNear, StringAlignmentCenter, true);
        std::lock_guard<std::recursive_mutex> lk(g_mx);
        auto apps = visibleApps();
        if (apps.empty()) text(g, g_page == 1 ? L"Brak dostępnych aktualizacji. Wszystkie aplikacje są aktualne." : L"Brak aplikacji.", RectF(x0, S(160), W - x0 - S(30), S(30)), 14, col::text3);
        for (int i = 0; i < (int)apps.size(); i++) {
            App* a = apps[i]; RectF c = cardRect(i, (float)W);
            fillRound(g, c, S(10), g_hoverCard == i ? 0x2a2a2a : col::panel);
            drawIcon(g, a->icon, RectF(c.X + S(20), c.Y + S(17), S(64), S(64)));
            float tx = c.X + S(104), tw = c.Width - S(104) - (a->phase ? S(420) : a->hasUpdate() ? S(400) : S(300));
            text(g, a->name, RectF(tx, c.Y + S(14), tw, S(26)), 16, col::text, FontStyleBold);
            text(g, a->desc, RectF(tx, c.Y + S(40), tw, S(22)), 12.5f, col::text2);
            std::wstring st2; unsigned stc = col::text3;
            if (a->isInstalled()) {
                st2 = L"Zainstalowano · wersja " + a->installed;
                if (a->hasUpdate()) { st2 += L"   →   dostępna " + a->latest; stc = col::orange; } else if (!a->latest.empty()) { st2 += L"  ·  aktualna"; stc = col::green; }
            } else st2 = a->url.empty() ? L"Niezainstalowano" : (L"Dostępna wersja " + a->latest + (a->size ? L" · " + fmtSize(a->size) : L""));
            text(g, st2, RectF(tx, c.Y + S(64), tw, S(22)), 12, stc);
            if (a->phase) {
                std::wstring bt; { bt = a->busyText; }
                float px = c.X + c.Width - S(400);
                text(g, bt, RectF(px, c.Y + S(22), S(250), S(22)), 12.5f, col::text2);
                progressBar(g, RectF(px, c.Y + S(52), a->phase == 1 ? S(250) : S(370), S(8)), a->phase == 1 ? a->prog.load() : 0.15 + 0.85 * fmod(GetTickCount() / 1500.0, 1.0));
            }
        }
    } else if (g_page == 2) {
        text(g, L"Adres listy aplikacji (manifest JSON) – stąd Hub pobiera informacje o nowych wersjach:", RectF(x0, S(126), W - x0 - S(30), S(24)), 13, col::text2);
        fillRound(g, RectF(x0, S(160), W - x0 - S(30) - S(120) - S(12), S(36)), S(6), 0x141414);
        strokeRound(g, RectF(x0, S(160), W - x0 - S(30) - S(120) - S(12), S(36)), S(6), 0x3a3a3a);
        text(g, L"Przykład: https://github.com/<użytkownik>/topaz-releases/releases/latest/download/manifest.json", RectF(x0, S(200), W - x0 - S(30), S(22)), 11.5f, col::text3);
        text(g, L"Jak wydać aktualizację: zbuduj nową wersję (build.py), wgraj instalator i manifest.json do wydania (np. GitHub Releases). "
                L"Hub porówna numer wersji z zainstalowaną, pobierze instalator, sprawdzi sumę SHA-256 i zainstaluje go w tle.",
             RectF(x0, S(370), W - x0 - S(40), S(80)), 12.5f, col::text3, FontStyleRegular, StringAlignmentNear, StringAlignmentNear, true);
    } else if (g_page == 3) {
        if (g_logoHub) g.DrawImage(g_logoHub, x0, S(100), S(120), S(120));
        text(g, L"TopaZ Creative Hub", RectF(x0 + S(150), S(110), S(500), S(34)), 22, col::text, FontStyleBold);
        text(g, std::wstring(L"Wersja ") + HUB_VERSION, RectF(x0 + S(150), S(148), S(500), S(22)), 13, col::text2);
        text(g, L"Centrum aplikacji TopaZ: instalowanie, uruchamianie, aktualizacje i odinstalowywanie programów.\nNapisane w C++ (Win32, GDI+, WinHTTP, BCrypt).\n\n© 2026 TopaZ. Wszelkie prawa zastrzeżone.",
             RectF(x0 + S(150), S(180), W - x0 - S(190), S(120)), 13, col::text3, FontStyleRegular, StringAlignmentNear, StringAlignmentNear, true);
    }
    for (auto& w : g_w.w) if (w.kind != 5) drawWidget(g, w);
    Graphics(hdc).DrawImage(&buf, 0, 0);
}

static void appMenu(App* a, POINT pt) {
    HMENU m = CreatePopupMenu();
    AppendMenuW(m, MF_STRING, 1, L"Otwórz");
    AppendMenuW(m, MF_STRING, 2, L"Pokaż folder instalacji");
    AppendMenuW(m, MF_STRING | (a->url.empty() ? MF_GRAYED : 0), 3, L"Zainstaluj ponownie");
    if (!a->notes.empty()) AppendMenuW(m, MF_STRING, 5, L"Co nowego…");
    AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(m, MF_STRING, 4, L"Odinstaluj…");
    int r = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, g_hwnd, nullptr);
    DestroyMenu(m);
    if (r == 1) launch(join(a->path, a->exe));
    else if (r == 2) ShellExecuteW(nullptr, L"open", a->path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    else if (r == 3) runInstall(a);
    else if (r == 4) runUninstall(a);
    else if (r == 5) MessageBoxW(g_hwnd, a->notes.c_str(), (a->name + L" " + a->latest + L" – co nowego").c_str(), MB_ICONINFORMATION);
}
static void installFromFile() {
    std::wstring f = pickFile(g_hwnd, L"Instalator TopaZ (*.exe)", L"*.exe", L"Wybierz instalator TopaZ");
    if (f.empty()) return;
    setStatus(L"Uruchamianie instalatora…");
    std::thread([f]() { DWORD c = runAndWait(f, L""); loadCatalog(); setStatus(c == 0 ? L"Instalacja zakończona" : L"Instalator został zamknięty", false); PostMessageW(g_hwnd, WM_APP + 1, 0, 0); }).detach();
}

static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
    switch (m) {
    case WM_CREATE: {
        g_hwnd = h; initDpi(h);
        BOOL dark = TRUE; DwmSetWindowAttribute(h, 20, &dark, sizeof(dark));
        g_font = CreateFontW(-(int)S(14), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
        g_editBrush = CreateSolidBrush(RGB(0x14, 0x14, 0x14));
        g_urlEdit = CreateWindowExW(0, L"EDIT", manifestUrl().c_str(), WS_CHILD | ES_AUTOHSCROLL, 0, 0, 10, 10, h, nullptr, nullptr, nullptr);
        SendMessageW(g_urlEdit, WM_SETFONT, (WPARAM)g_font, TRUE);
        g_nid.cbSize = sizeof(g_nid); g_nid.hWnd = h; g_nid.uID = 1; g_nid.uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE; g_nid.uCallbackMessage = WM_APP + 5;
        g_nid.hIcon = (HICON)LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
        wcscpy(g_nid.szTip, L"TopaZ Creative Hub"); Shell_NotifyIconW(NIM_ADD, &g_nid);
        loadCatalog(); layout();
        if (regGetDword(HKEY_CURRENT_USER, REG_HUB, L"AutoCheck", 1)) { checkUpdates(false); SetTimer(h, 2, 6 * 3600 * 1000, nullptr); }
        SetTimer(h, 1, 250, nullptr);
        return 0; }
    case WM_TIMER:
        if (wp == 1) { bool busy = false; for (auto& a : g_apps) if (a->phase == 2 || a->phase == 3) busy = true; if (busy) InvalidateRect(h, nullptr, FALSE); }
        if (wp == 2) checkUpdates(false);
        return 0;
    case WM_CTLCOLOREDIT: { HDC dc = (HDC)wp; SetTextColor(dc, RGB(0xe6, 0xe6, 0xe6)); SetBkColor(dc, RGB(0x14, 0x14, 0x14)); return (LRESULT)g_editBrush; }
    case WM_ERASEBKGND: return 1;
    case WM_SIZE: layout(); InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_GETMINMAXINFO: { auto* mm = (MINMAXINFO*)lp; mm->ptMinTrackSize.x = (LONG)S(900); mm->ptMinTrackSize.y = (LONG)S(560); return 0; }
    case WM_PAINT: { PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); paint(dc); EndPaint(h, &ps); return 0; }
    case WM_MOUSEMOVE: {
        float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp); Widget* w = g_w.hit(x, y); bool ch = false;
        for (auto& a : g_w.w) { bool hv = (&a == w); if (a.hover != hv) { a.hover = hv; ch = true; } }
        RECT rc; GetClientRect(h, &rc); int hc = -1;
        if (g_page <= 1) { auto apps = visibleApps(); for (int i = 0; i < (int)apps.size(); i++) { RectF c = cardRect(i, (float)rc.right); if (c.Contains(x, y)) hc = i; } }
        if (hc != g_hoverCard) { g_hoverCard = hc; ch = true; }
        if (ch) InvalidateRect(h, nullptr, FALSE);
        TRACKMOUSEEVENT t = { sizeof(t), TME_LEAVE, h, 0 }; TrackMouseEvent(&t);
        SetCursor(LoadCursor(nullptr, w ? IDC_HAND : IDC_ARROW));
        return 0; }
    case WM_SETCURSOR: if (LOWORD(lp) == HTCLIENT) return TRUE; break;
    case WM_MOUSELEAVE: for (auto& a : g_w.w) a.hover = false; g_hoverCard = -1; InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_LBUTTONUP: {
        Widget* w = g_w.hit((float)GET_X_LPARAM(lp), (float)GET_Y_LPARAM(lp)); if (!w) return 0;
        int id = w->id;
        if (id == N_APPS) g_page = 0; else if (id == N_UPD) g_page = 1; else if (id == N_SET) { g_page = 2; SetWindowTextW(g_urlEdit, manifestUrl().c_str()); } else if (id == N_ABOUT) g_page = 3;
        else if (id == B_CHECK) checkUpdates(true);
        else if (id == B_FROMFILE) installFromFile();
        else if (id == B_SAVEURL) {
            wchar_t b[2048]; GetWindowTextW(g_urlEdit, b, 2048); std::wstring u = b;
            while (!u.empty() && iswspace(u.back())) u.pop_back();
            if (!u.empty() && u.rfind(L"https://", 0) != 0 && u.rfind(L"http://", 0) != 0) { MessageBoxW(h, L"Adres musi zaczynać się od https://", L"TopaZ Creative Hub", MB_ICONWARNING); return 0; }
            regSet(HKEY_CURRENT_USER, REG_HUB, L"ManifestURL", u); setStatus(L"Zapisano adres listy aplikacji"); checkUpdates(true); g_page = 0;
        }
        else if (id == C_AUTOSTART) {
            w->checked = !w->checked;
            if (w->checked) regSet(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", L"TopaZ Creative Hub", L"\"" + exePath() + L"\" --minimized");
            else regDeleteValue(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", L"TopaZ Creative Hub");
        }
        else if (id == C_AUTOCHECK) { w->checked = !w->checked; regSetDword(HKEY_CURRENT_USER, REG_HUB, L"AutoCheck", w->checked ? 1 : 0); }
        else if (id >= CARD_BASE) {
            std::lock_guard<std::recursive_mutex> lk(g_mx);
            auto apps = visibleApps(); int i = (id - CARD_BASE) / 10, k = (id - CARD_BASE) % 10;
            if (i < (int)apps.size()) {
                App* a = apps[i];
                if (k == 0) runInstall(a);
                else if (k == 1) { if (!launch(join(a->path, a->exe))) MessageBoxW(h, L"Nie można uruchomić programu.", L"TopaZ Creative Hub", MB_ICONERROR); }
                else if (k == 2) { POINT p; GetCursorPos(&p); appMenu(a, p); }
                else if (k == 3) a->cancel = true;
            }
        }
        layout(); InvalidateRect(h, nullptr, FALSE);
        return 0; }
    case WM_APP: InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_APP + 1: layout(); InvalidateRect(h, nullptr, FALSE); return 0;
    case WM_APP + 5:
        if (LOWORD(lp) == WM_LBUTTONUP || LOWORD(lp) == NIN_BALLOONUSERCLICK || LOWORD(lp) == WM_LBUTTONDBLCLK) { ShowWindow(h, SW_RESTORE); SetForegroundWindow(h); }
        else if (LOWORD(lp) == WM_RBUTTONUP) {
            HMENU mn = CreatePopupMenu(); AppendMenuW(mn, MF_STRING, 1, L"Otwórz TopaZ Creative Hub"); AppendMenuW(mn, MF_STRING, 2, L"Sprawdź aktualizacje"); AppendMenuW(mn, MF_SEPARATOR, 0, nullptr); AppendMenuW(mn, MF_STRING, 3, L"Zakończ");
            POINT p; GetCursorPos(&p); SetForegroundWindow(h);
            int r = TrackPopupMenu(mn, TPM_RETURNCMD, p.x, p.y, 0, h, nullptr); DestroyMenu(mn);
            if (r == 1) { ShowWindow(h, SW_RESTORE); SetForegroundWindow(h); } else if (r == 2) checkUpdates(true); else if (r == 3) DestroyWindow(h);
        }
        return 0;
    case WM_CLOSE: {
        bool busy = false; for (auto& a : g_apps) if (a->phase) busy = true;
        if (busy && MessageBoxW(h, L"Trwa instalacja. Zamknąć mimo to?", L"TopaZ Creative Hub", MB_YESNO | MB_ICONWARNING) != IDYES) return 0;
        DestroyWindow(h); return 0; }
    case WM_DPICHANGED: { initDpi(h); RECT* r = (RECT*)lp; SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER); layout(); return 0; }
    case WM_DESTROY: Shell_NotifyIconW(NIM_DELETE, &g_nid); PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(h, m, wp, lp);
}

int WINAPI wWinMain(HINSTANCE hi, HINSTANCE, PWSTR cmd, int show) {
    HANDLE mtx = CreateMutexW(nullptr, TRUE, L"TopaZCreativeHub_SingleInstance");
    if (GetLastError() == ERROR_ALREADY_EXISTS) { HWND o = FindWindowW(L"TopaZCreativeHubWnd", nullptr); if (o) { ShowWindow(o, SW_RESTORE); SetForegroundWindow(o); } return 0; }
    setDpiAware();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    GdiplusStartupInput gsi; ULONG_PTR tok; GdiplusStartup(&tok, &gsi, nullptr);
    g_logoHub = loadPng(IDR_LOGO_HUB); g_logoEd = loadPng(IDR_LOGO_ED);
    WNDCLASSEXW wc = { sizeof(wc) }; wc.lpfnWndProc = WndProc; wc.hInstance = hi; wc.lpszClassName = L"TopaZCreativeHubWnd";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW); wc.hIcon = LoadIconW(hi, MAKEINTRESOURCEW(1));
    wc.hIconSm = (HICON)LoadImageW(hi, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
    RegisterClassExW(&wc);
    HDC sdc = GetDC(nullptr); float sc = GetDeviceCaps(sdc, LOGPIXELSX) / 96.0f; ReleaseDC(nullptr, sdc);
    int ww = (int)(1120 * sc), wh = (int)(720 * sc);
    RECT wa; SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
    HWND h = CreateWindowExW(0, wc.lpszClassName, L"TopaZ Creative Hub", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                             (wa.left + wa.right - ww) / 2, (wa.top + wa.bottom - wh) / 2, ww, wh, nullptr, nullptr, hi, nullptr);
    bool minimized = cmd && wcsstr(cmd, L"--minimized");
    ShowWindow(h, minimized ? SW_SHOWMINNOACTIVE : show);
    MSG msg; while (GetMessageW(&msg, nullptr, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    GdiplusShutdown(tok); CoUninitialize(); if (mtx) CloseHandle(mtx);
    return 0;
}
