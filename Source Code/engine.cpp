// =====================================================================
//  TopazMediaEngine.exe  —  native export engine for TopaZ Editing Pro 26
//  C++ / Windows Media Foundation
//
//  Reads raw RGBA frames (width*height*4 bytes each) from stdin, converts
//  them to NV12 (BT.709) and encodes H.264 video + AAC audio into an MP4
//  container using the system (hardware when available) encoders.
//  Audio is read from an interleaved 16-bit PCM file (--audio).
//
//  Protocol:  engine prints "READY" when it is ready for frames,
//             "PROGRESS <n>" every 30 frames, "DONE <frames>" at the end.
// =====================================================================
#ifndef WINVER
#define WINVER 0x0A00
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <codecapi.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <thread>

#define ENGINE_VERSION "26.1.0"

template <class T> static void SafeRelease(T** p) { if (*p) { (*p)->Release(); *p = nullptr; } }

static void fail(const char* what, HRESULT hr) {
    fprintf(stderr, "ERROR: %s (hr=0x%08lX)\n", what, (unsigned long)hr);
    fflush(stderr);
}
#define CHECK(x, msg) do { hr = (x); if (FAILED(hr)) { fail(msg, hr); return hr; } } while (0)

struct Options {
    std::wstring out, audio;
    UINT32 width = 1920, height = 1080;
    double fps = 30.0;
    UINT32 vbitrate = 16000000, abitrate = 192000, sampleRate = 48000, channels = 2, threads = 0;
};

static void fpsToRatio(double fps, UINT32& num, UINT32& den) {
    struct { double f; UINT32 n, d; } table[] = {
        {23.976, 24000, 1001}, {29.97, 30000, 1001}, {59.94, 60000, 1001}, {47.952, 48000, 1001}, {119.88, 120000, 1001}
    };
    for (auto& t : table) if (fabs(fps - t.f) < 0.01) { num = t.n; den = t.d; return; }
    num = (UINT32)(fps * 1000.0 + 0.5); den = 1000;
    if (num % 1000 == 0) { num /= 1000; den = 1; }
}

// ---------- RGBA -> NV12 (BT.709, limited range) ----------
static void rgbaToNV12Rows(const uint8_t* src, uint8_t* dst, UINT32 w, UINT32 h, UINT32 y0, UINT32 y1) {
    uint8_t* Y = dst;
    uint8_t* UV = dst + (size_t)w * h;
    for (UINT32 y = y0; y < y1; y += 2) {
        const uint8_t* r0 = src + (size_t)y * w * 4;
        const uint8_t* r1 = r0 + (size_t)w * 4;
        uint8_t* y0 = Y + (size_t)y * w;
        uint8_t* y1 = y0 + w;
        uint8_t* uv = UV + (size_t)(y / 2) * w;
        for (UINT32 x = 0; x < w; x += 2) {
            int R[4], G[4], B[4];
            const uint8_t* p[4] = { r0 + x * 4, r0 + (x + 1) * 4, r1 + x * 4, r1 + (x + 1) * 4 };
            for (int i = 0; i < 4; i++) { R[i] = p[i][0]; G[i] = p[i][1]; B[i] = p[i][2]; }
            uint8_t* yy[4] = { y0 + x, y0 + x + 1, y1 + x, y1 + x + 1 };
            int sr = 0, sg = 0, sb = 0;
            for (int i = 0; i < 4; i++) {
                int v = 16 + ((47 * R[i] + 157 * G[i] + 16 * B[i] + 128) >> 8);
                *yy[i] = (uint8_t)(v < 16 ? 16 : v > 235 ? 235 : v);
                sr += R[i]; sg += G[i]; sb += B[i];
            }
            sr >>= 2; sg >>= 2; sb >>= 2;
            int u = 128 + ((-26 * sr - 87 * sg + 112 * sb + 128) >> 8);
            int v = 128 + ((112 * sr - 102 * sg - 10 * sb + 128) >> 8);
            uv[x] = (uint8_t)(u < 16 ? 16 : u > 240 ? 240 : u);
            uv[x + 1] = (uint8_t)(v < 16 ? 16 : v > 240 ? 240 : v);
        }
    }
}
// multi-threaded conversion (rows split in even bands)
static void rgbaToNV12(const uint8_t* src, uint8_t* dst, UINT32 w, UINT32 h, UINT32 threads) {
    if (threads <= 1 || h < 64) { rgbaToNV12Rows(src, dst, w, h, 0, h); return; }
    std::vector<std::thread> pool;
    UINT32 band = ((h / threads) + 1) & ~1u;
    for (UINT32 i = 0; i < threads; i++) {
        UINT32 a = i * band, b = (i + 1 == threads) ? h : (a + band);
        if (a >= h) break; if (b > h) b = h;
        pool.emplace_back(rgbaToNV12Rows, src, dst, w, h, a, b);
    }
    for (auto& t : pool) t.join();
}

static bool readExact(HANDLE h, uint8_t* buf, size_t n) {
    size_t got = 0;
    while (got < n) {
        DWORD chunk = (DWORD)((n - got) > (1 << 24) ? (1 << 24) : (n - got));
        DWORD rd = 0;
        if (!ReadFile(h, buf + got, chunk, &rd, nullptr) || rd == 0) return false;
        got += rd;
    }
    return true;
}

static UINT32 aacBytesPerSec(UINT32 bitrate) {
    // Media Foundation AAC encoder accepts 12000, 16000, 20000, 24000 bytes/s
    UINT32 b = bitrate / 8;
    if (b <= 12000) return 12000;
    if (b <= 16000) return 16000;
    if (b <= 20000) return 20000;
    return 24000;
}

static HRESULT run(const Options& o) {
    HRESULT hr = S_OK;
    IMFAttributes* attrs = nullptr;
    IMFSinkWriter* writer = nullptr;
    IMFMediaType *vOut = nullptr, *vIn = nullptr, *aOut = nullptr, *aIn = nullptr;
    DWORD vStream = 0, aStream = 0;
    UINT32 num = 30, den = 1;
    fpsToRatio(o.fps, num, den);

    FILE* pcm = nullptr;
    bool hasAudio = false;
    if (!o.audio.empty()) {
        pcm = _wfopen(o.audio.c_str(), L"rb");
        if (pcm) { fseek(pcm, 0, SEEK_END); long sz = ftell(pcm); fseek(pcm, 0, SEEK_SET); hasAudio = sz > 0; }
    }

    CHECK(MFCreateAttributes(&attrs, 3), "MFCreateAttributes");
    attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    attrs->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_MPEG4);
    CHECK(MFCreateSinkWriterFromURL(o.out.c_str(), nullptr, attrs, &writer), "Nie mozna utworzyc pliku wyjsciowego");

    // ----- video output (H.264)
    CHECK(MFCreateMediaType(&vOut), "MFCreateMediaType");
    vOut->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    vOut->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    vOut->SetUINT32(MF_MT_AVG_BITRATE, o.vbitrate);
    vOut->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    vOut->SetUINT32(MF_MT_MPEG2_PROFILE, (o.width * o.height > 1920 * 1088) ? eAVEncH264VProfile_High : eAVEncH264VProfile_Main);
    MFSetAttributeSize(vOut, MF_MT_FRAME_SIZE, o.width, o.height);
    MFSetAttributeRatio(vOut, MF_MT_FRAME_RATE, num, den);
    MFSetAttributeRatio(vOut, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    CHECK(writer->AddStream(vOut, &vStream), "Koder H.264 niedostepny");

    // ----- video input (NV12)
    CHECK(MFCreateMediaType(&vIn), "MFCreateMediaType");
    vIn->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    vIn->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    vIn->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    vIn->SetUINT32(MF_MT_DEFAULT_STRIDE, o.width);
    vIn->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
    MFSetAttributeSize(vIn, MF_MT_FRAME_SIZE, o.width, o.height);
    MFSetAttributeRatio(vIn, MF_MT_FRAME_RATE, num, den);
    MFSetAttributeRatio(vIn, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    CHECK(writer->SetInputMediaType(vStream, vIn, nullptr), "Nieobslugiwany format wejscia wideo");

    // ----- audio
    if (hasAudio) {
        CHECK(MFCreateMediaType(&aOut), "MFCreateMediaType");
        aOut->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
        aOut->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
        aOut->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
        aOut->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, o.sampleRate);
        aOut->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, o.channels);
        aOut->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, aacBytesPerSec(o.abitrate));
        hr = writer->AddStream(aOut, &aStream);
        if (FAILED(hr)) { fail("Koder AAC niedostepny - eksport bez dzwieku", hr); hasAudio = false; hr = S_OK; }
    }
    if (hasAudio) {
        CHECK(MFCreateMediaType(&aIn), "MFCreateMediaType");
        aIn->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
        aIn->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
        aIn->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
        aIn->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, o.sampleRate);
        aIn->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, o.channels);
        aIn->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 2 * o.channels);
        aIn->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 2 * o.channels * o.sampleRate);
        CHECK(writer->SetInputMediaType(aStream, aIn, nullptr), "Nieobslugiwany format audio");
    }

    CHECK(writer->BeginWriting(), "BeginWriting");
    printf("READY\n"); fflush(stdout);

    const size_t frameBytes = (size_t)o.width * o.height * 4;
    const DWORD nv12Bytes = o.width * o.height * 3 / 2;
    std::vector<uint8_t> rgba(frameBytes);
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    const LONGLONG frameDur = (LONGLONG)(10000000.0 * den / num + 0.5);
    UINT64 frames = 0, audioWritten = 0;
    const UINT32 blockAlign = 2 * o.channels;
    std::vector<uint8_t> abuf;

    auto writeAudioUntil = [&](UINT64 targetSamples) -> HRESULT {
        if (!hasAudio) return S_OK;
        while (audioWritten < targetSamples) {
            UINT64 n = targetSamples - audioWritten;
            if (n > o.sampleRate / 10) n = o.sampleRate / 10;
            abuf.resize((size_t)n * blockAlign);
            size_t rd = fread(abuf.data(), 1, abuf.size(), pcm);
            if (rd < blockAlign) { hasAudio = false; return S_OK; }
            n = rd / blockAlign;
            IMFMediaBuffer* mb = nullptr; IMFSample* s = nullptr; BYTE* d = nullptr;
            HRESULT h2 = MFCreateMemoryBuffer((DWORD)(n * blockAlign), &mb);
            if (SUCCEEDED(h2)) h2 = mb->Lock(&d, nullptr, nullptr);
            if (SUCCEEDED(h2)) { memcpy(d, abuf.data(), (size_t)(n * blockAlign)); mb->Unlock(); mb->SetCurrentLength((DWORD)(n * blockAlign)); }
            if (SUCCEEDED(h2)) h2 = MFCreateSample(&s);
            if (SUCCEEDED(h2)) h2 = s->AddBuffer(mb);
            if (SUCCEEDED(h2)) { s->SetSampleTime((LONGLONG)(audioWritten * 10000000ULL / o.sampleRate)); s->SetSampleDuration((LONGLONG)(n * 10000000ULL / o.sampleRate)); }
            if (SUCCEEDED(h2)) h2 = writer->WriteSample(aStream, s);
            SafeRelease(&s); SafeRelease(&mb);
            if (FAILED(h2)) { fail("WriteSample audio", h2); return h2; }
            audioWritten += n;
        }
        return S_OK;
    };

    while (readExact(in, rgba.data(), frameBytes)) {
        IMFMediaBuffer* mb = nullptr; IMFSample* s = nullptr; BYTE* d = nullptr;
        CHECK(MFCreateMemoryBuffer(nv12Bytes, &mb), "MFCreateMemoryBuffer");
        hr = mb->Lock(&d, nullptr, nullptr);
        if (SUCCEEDED(hr)) { rgbaToNV12(rgba.data(), d, o.width, o.height, o.threads); mb->Unlock(); mb->SetCurrentLength(nv12Bytes); }
        if (SUCCEEDED(hr)) hr = MFCreateSample(&s);
        if (SUCCEEDED(hr)) hr = s->AddBuffer(mb);
        if (SUCCEEDED(hr)) { s->SetSampleTime((LONGLONG)frames * frameDur); s->SetSampleDuration(frameDur); }
        if (SUCCEEDED(hr)) hr = writer->WriteSample(vStream, s);
        SafeRelease(&s); SafeRelease(&mb);
        if (FAILED(hr)) { fail("WriteSample video", hr); break; }
        frames++;
        UINT64 target = (UINT64)((double)frames * den / num * o.sampleRate + 0.5);
        if (FAILED(hr = writeAudioUntil(target))) break;
        if (frames % 30 == 0) { printf("PROGRESS %llu\n", (unsigned long long)frames); fflush(stdout); }
    }
    if (SUCCEEDED(hr)) {
        UINT64 target = (UINT64)((double)frames * den / num * o.sampleRate + 0.5);
        writeAudioUntil(target);
        if (frames == 0) { fprintf(stderr, "ERROR: nie otrzymano zadnej klatki\n"); hr = E_FAIL; }
        else {
            hr = writer->Finalize();
            if (FAILED(hr)) fail("Finalize", hr);
        }
    }
    if (pcm) fclose(pcm);
    SafeRelease(&aIn); SafeRelease(&aOut); SafeRelease(&vIn); SafeRelease(&vOut);
    SafeRelease(&writer); SafeRelease(&attrs);
    if (SUCCEEDED(hr)) { printf("DONE %llu\n", (unsigned long long)frames); fflush(stdout); }
    return hr;
}

int wmain(int argc, wchar_t** argv) {
    Options o;
    for (int i = 1; i < argc; i++) {
        std::wstring a = argv[i];
        auto next = [&]() -> std::wstring { return i + 1 < argc ? std::wstring(argv[++i]) : L""; };
        if (a == L"--version" || a == L"-v") { printf("TopazMediaEngine %s\n", ENGINE_VERSION); return 0; }
        else if (a == L"--out") o.out = next();
        else if (a == L"--audio") o.audio = next();
        else if (a == L"--width") o.width = (UINT32)_wtoi(next().c_str());
        else if (a == L"--height") o.height = (UINT32)_wtoi(next().c_str());
        else if (a == L"--fps") o.fps = _wtof(next().c_str());
        else if (a == L"--vbitrate") o.vbitrate = (UINT32)_wtoi(next().c_str());
        else if (a == L"--abitrate") o.abitrate = (UINT32)_wtoi(next().c_str());
        else if (a == L"--samplerate") o.sampleRate = (UINT32)_wtoi(next().c_str());
        else if (a == L"--channels") o.channels = (UINT32)_wtoi(next().c_str());
        else if (a == L"--threads") o.threads = (UINT32)_wtoi(next().c_str());
        else if (a == L"--help" || a == L"-h") {
            printf("TopazMediaEngine %s\nUzycie: TopazMediaEngine --out plik.mp4 --width W --height H --fps F [--vbitrate bps] [--audio pcm16.raw --samplerate 48000 --channels 2 --abitrate bps]\n"
                   "Klatki RGBA (W*H*4 bajtow) czytane sa ze standardowego wejscia.\n", ENGINE_VERSION);
            return 0;
        }
    }
    if (o.out.empty() || o.width < 16 || o.height < 16 || o.fps <= 0) { fprintf(stderr, "ERROR: brak wymaganych parametrow (--help)\n"); return 2; }
    o.width &= ~1u; o.height &= ~1u;
    if (o.threads == 0) { unsigned hc = std::thread::hardware_concurrency(); o.threads = hc ? (hc > 16 ? 16 : hc) : 4; }
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) { fail("CoInitializeEx", hr); return 1; }
    hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) { fail("MFStartup (Media Foundation niedostepne)", hr); CoUninitialize(); return 1; }
    hr = run(o);
    MFShutdown();
    CoUninitialize();
    return SUCCEEDED(hr) ? 0 : 1;
}
