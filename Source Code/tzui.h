// =====================================================================
//  tzui.h — shared GDI+ UI helpers for TopaZ native apps (Setup, Hub)
// =====================================================================
#pragma once
#ifndef WINVER
#define WINVER 0x0A00
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <windowsx.h>
#include <objidl.h>
#include <shlwapi.h>
#include <gdiplus.h>
#include <string>
#include <vector>
#include <functional>
#include <algorithm>

namespace tz {
using namespace Gdiplus;

inline float g_scale = 1.0f;
inline float S(float v) { return v * g_scale; }
inline Color RGBc(unsigned rgb, BYTE a = 255) { return Color(a, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }

namespace col {
    constexpr unsigned bg = 0x1b1b1b, panel = 0x232323, panel2 = 0x2b2b2b, line = 0x333333, text = 0xe6e6e6, text2 = 0xa8a8a8, text3 = 0x7a7a7a,
        accent = 0x2f8bf0, accentHi = 0x4a9df5, green = 0x2fb36c, red = 0xe0534a, orange = 0xff8a3d, purple = 0xb48cff;
}

inline void initDpi(HWND hwnd) {
    HMODULE u = GetModuleHandleW(L"user32.dll");
    typedef UINT(WINAPI * GDFW)(HWND);
    auto f = (GDFW)GetProcAddress(u, "GetDpiForWindow");
    UINT dpi = 96;
    if (f && hwnd) dpi = f(hwnd); else { HDC dc = GetDC(nullptr); dpi = GetDeviceCaps(dc, LOGPIXELSX); ReleaseDC(nullptr, dc); }
    g_scale = dpi / 96.0f;
}
inline void setDpiAware() {
    HMODULE u = GetModuleHandleW(L"user32.dll");
    typedef BOOL(WINAPI * SPDAC)(HANDLE);
    auto f = (SPDAC)GetProcAddress(u, "SetProcessDpiAwarenessContext");
    if (f) f((HANDLE)-4); // PER_MONITOR_AWARE_V2
    else SetProcessDPIAware();
}

inline void roundPath(GraphicsPath& p, RectF r, float rad) {
    float d = rad * 2;
    if (d > r.Height) d = r.Height; if (d > r.Width) d = r.Width;
    if (d <= 0.5f) { p.AddRectangle(r); return; }
    p.AddArc(r.X, r.Y, d, d, 180, 90);
    p.AddArc(r.X + r.Width - d, r.Y, d, d, 270, 90);
    p.AddArc(r.X + r.Width - d, r.Y + r.Height - d, d, d, 0, 90);
    p.AddArc(r.X, r.Y + r.Height - d, d, d, 90, 90);
    p.CloseFigure();
}
inline void fillRound(Graphics& g, RectF r, float rad, unsigned rgb, BYTE a = 255) {
    GraphicsPath p; roundPath(p, r, rad); SolidBrush b(RGBc(rgb, a)); g.FillPath(&b, &p);
}
inline void strokeRound(Graphics& g, RectF r, float rad, unsigned rgb, float w = 1, BYTE a = 255) {
    GraphicsPath p; roundPath(p, r, rad); Pen pen(RGBc(rgb, a), w); g.DrawPath(&pen, &p);
}
inline FontFamily* family() {
    static FontFamily* f = nullptr;
    if (!f) {
        const wchar_t* names[] = { L"Segoe UI", L"Segoe UI Variable Text", L"Tahoma", L"Arial", L"DejaVu Sans" };
        for (auto n : names) { f = new FontFamily(n); if (f->IsAvailable() && f->GetLastStatus() == Ok) break; delete f; f = nullptr; }
        if (!f) f = FontFamily::GenericSansSerif()->Clone();
    }
    return f;
}
inline void text(Graphics& g, const std::wstring& s, RectF r, float size, unsigned rgb, int style = FontStyleRegular,
                 StringAlignment h = StringAlignmentNear, StringAlignment v = StringAlignmentCenter, bool wrap = false, BYTE a = 255) {
    Font f(family(), S(size), style, UnitPixel);
    StringFormat sf;
    sf.SetAlignment(h); sf.SetLineAlignment(v);
    if (!wrap) { sf.SetFormatFlags(StringFormatFlagsNoWrap); sf.SetTrimming(StringTrimmingEllipsisCharacter); }
    SolidBrush b(RGBc(rgb, a));
    g.DrawString(s.c_str(), -1, &f, r, &sf, &b);
}
inline float textWidth(Graphics& g, const std::wstring& s, float size, int style = FontStyleRegular) {
    Font f(family(), S(size), style, UnitPixel);
    RectF out; g.MeasureString(s.c_str(), -1, &f, PointF(0, 0), &out); return out.Width;
}
inline Bitmap* loadPng(int resId) {
    HRSRC r = FindResourceW(nullptr, MAKEINTRESOURCEW(resId), RT_RCDATA);
    if (!r) return nullptr;
    HGLOBAL hg = LoadResource(nullptr, r); DWORD sz = SizeofResource(nullptr, r);
    void* data = LockResource(hg);
    IStream* st = SHCreateMemStream((const BYTE*)data, sz);
    if (!st) return nullptr;
    Bitmap* b = Bitmap::FromStream(st);
    st->Release();
    return b;
}

// ---------- simple widgets ----------
struct Widget {
    int id = 0; RectF r; std::wstring label; bool visible = true, enabled = true, hover = false, down = false;
    int kind = 0; // 0=button primary,1=button secondary,2=checkbox,3=link,4=icon button
    bool checked = false;
};
struct WidgetSet {
    std::vector<Widget> w;
    Widget* get(int id) { for (auto& x : w) if (x.id == id) return &x; return nullptr; }
    Widget* hit(float x, float y) { for (auto& a : w) if (a.visible && a.enabled && x >= a.r.X && x <= a.r.X + a.r.Width && y >= a.r.Y && y <= a.r.Y + a.r.Height) return &a; return nullptr; }
    void add(int id, int kind, const std::wstring& label, RectF r, bool checked = false) {
        Widget* e = get(id);
        if (!e) { w.push_back(Widget()); e = &w.back(); e->id = id; e->checked = checked; }
        e->kind = kind; e->label = label; e->r = r; e->visible = true;
    }
    void hideAll() { for (auto& a : w) a.visible = false; }
};
inline void drawWidget(Graphics& g, const Widget& b) {
    if (!b.visible) return;
    if (b.kind == 0 || b.kind == 1) {
        unsigned c = b.kind == 0 ? (b.hover ? col::accentHi : col::accent) : (b.hover ? 0x4a4a4a : 0x3a3a3a);
        BYTE a = b.enabled ? 255 : 110;
        fillRound(g, b.r, b.r.Height / 2, c, a);
        text(g, b.label, b.r, 13, b.kind == 0 ? 0xffffff : col::text, FontStyleBold, StringAlignmentCenter, StringAlignmentCenter, false, a);
    } else if (b.kind == 2) {
        RectF box(b.r.X, b.r.Y + (b.r.Height - S(16)) / 2, S(16), S(16));
        if (b.checked) { fillRound(g, box, S(3), col::accent); Pen p(Color(255, 255, 255, 255), S(2)); p.SetLineJoin(LineJoinRound);
            PointF pts[3] = { PointF(box.X + S(3.5f), box.Y + S(8.5f)), PointF(box.X + S(6.8f), box.Y + S(11.8f)), PointF(box.X + S(12.5f), box.Y + S(4.5f)) }; g.DrawLines(&p, pts, 3); }
        else strokeRound(g, box, S(3), b.hover ? 0x9a9a9a : 0x6a6a6a, S(1.4f));
        text(g, b.label, RectF(b.r.X + S(26), b.r.Y, b.r.Width - S(26), b.r.Height), 13, b.enabled ? col::text : col::text3);
    } else if (b.kind == 3) {
        text(g, b.label, b.r, 13, b.hover ? col::accentHi : col::accent, b.hover ? FontStyleUnderline : FontStyleRegular);
    } else if (b.kind == 4) {
        if (b.hover) fillRound(g, b.r, S(4), b.label == L"\u2715" ? col::red : 0x3a3a3a);
        float cx = b.r.X + b.r.Width / 2, cy = b.r.Y + b.r.Height / 2;
        Pen pen(RGBc(col::text), S(1.3f));
        if (b.label == L"\u2715") { float d = S(5); g.DrawLine(&pen, cx - d, cy - d, cx + d, cy + d); g.DrawLine(&pen, cx - d, cy + d, cx + d, cy - d); }
        else if (b.label == L"\u2014") { float d = S(5); g.DrawLine(&pen, cx - d, cy, cx + d, cy); }
        else if (b.label == L"\u22EF") { SolidBrush br(RGBc(col::text)); for (int i = -1; i <= 1; i++) g.FillEllipse(&br, cx + i * S(6) - S(1.8f), cy - S(1.8f), S(3.6f), S(3.6f)); }
        else text(g, b.label, b.r, 13, col::text, FontStyleRegular, StringAlignmentCenter, StringAlignmentCenter);
    }
}
inline void progressBar(Graphics& g, RectF r, double p, unsigned c = col::accent) {
    fillRound(g, r, r.Height / 2, 0x151515);
    if (p > 0) {
        RectF f = r; f.Width = (float)(r.Width * (p > 1 ? 1 : p));
        if (f.Width < r.Height) f.Width = r.Height;
        LinearGradientBrush br(PointF(r.X, 0), PointF(r.X + r.Width, 0), RGBc(0x1f6fd0), RGBc(c));
        GraphicsPath pth; roundPath(pth, f, r.Height / 2); g.FillPath(&br, &pth);
    }
}

// ---------- misc helpers ----------
inline std::wstring utf8ToW(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0); MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n); return w;
}
inline std::string wToUtf8(const std::wstring& w) {
    if (w.empty()) return "";
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, 0); WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), &s[0], n, nullptr, nullptr); return s;
}
inline std::wstring fmtSize(unsigned long long b) {
    wchar_t buf[64];
    if (b >= 1024ull * 1024 * 1024) swprintf(buf, 64, L"%.2f GB", b / 1073741824.0);
    else if (b >= 1024 * 1024) swprintf(buf, 64, L"%.1f MB", b / 1048576.0);
    else swprintf(buf, 64, L"%.0f KB", b / 1024.0);
    return buf;
}
} // namespace tz
