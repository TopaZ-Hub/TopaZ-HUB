# TopaZ Editing Pro 26 + TopaZ Creative Hub

Nieliniowy edytor wideo dla Windows (x64) z instalatorem i centrum aplikacji.

## Architektura (jak w Adobe)

| Część | Język | Pliki |
|---|---|---|
| Natywny silnik eksportu `TopazMediaEngine.exe` (H.264/AAC → MP4, Media Foundation, sprzętowe kodery GPU) | **C++** | `native/engine/engine.cpp` |
| Instalator / deinstalator `Setup.exe` | **C++** (Win32, GDI+, miniz) | `native/setup/setup.cpp` |
| **TopaZ Creative Hub** – instalowanie, aktualizacje, odinstalowywanie | **C++** (Win32, GDI+, WinHTTP, BCrypt) | `native/hub/hub.cpp` |
| Wspólne biblioteki UI/systemowe | **C++** | `native/common/*.h` |
| Interfejs edytora, oś czasu, kompozytor, panele (jak UXP/CEP w Premiere) | **JavaScript** + GLSL (WebGL) | `renderer/js/*.js` |
| Proces główny aplikacji | JavaScript (Electron) | `main.js`, `preload.js` |
| System budowania i pakowania | **Python** | `build.py` |

## Nowości w 26.1
- **Silnik GPU (WebGL 2)** – całe składanie obrazu, efekty, Lumetri, przejścia i tryby mieszania liczone na karcie graficznej; każdy klip trzyma ostatnią klatkę w pamięci GPU (koniec czarnego podglądu), zegar czeka na buforujący dekoder zamiast „uciekać” (koniec zacinania)
- **Szybki eksport sprzętowy** – dekodowanie WebCodecs (GPU) bez przewijania klatka po klatce + kodowanie sprzętowe H.264/H.265/AV1 (AMD AMF / NVENC / Quick Sync) + własny muxer MP4
- Rozdzielczości do 8K (4K UHD/DCI, 2K QHD/DCI, pionowe, kwadrat), 23.976–120 kl./s, jakość/bitrate, VBR/CBR, presety YouTube/TikTok/Instagram/Discord (rozmiar docelowy)
- **90+ efektów wideo** w 15 folderach jak w Premiere, 23 efekty audio, 30+ przejść, ustawienia wstępne (Ken Burns, PiP, glitch, VHS…), ulubione, klatki kluczowe parametrów efektów z interpolacją
- **Preferencje**: GPU/CPU, wybór karty, dekodowanie sprzętowe, kodowanie sprzętowe, 8/16-bit, przydział RAM, liczba dekoderów, jakość podglądu (Auto)
- **Ctrl+klik** zaznacza pojedynczy klip (np. samo audio), menu „Usuń tylko audio/wideo”

## Funkcje edytora
- Panele jak w Premiere: Źródło, Elementy sterujące efektami, Zakresy Lumetri, Mikser audio, Program, Właściwości, Kolor Lumetri, Grafika i tekst, Projekt, Efekty, Historia, Informacje, oś czasu, mierniki audio
- Import wideo/audio/obrazów (przeciągnij i upuść), miniatury, przewijanie po najechaniu, przebiegi audio
- Oś czasu: wiele ścieżek V/A, przyciąganie, połączone klipy, zaznaczanie ramką, narzędzia: Zaznaczanie, Ścieżka w przód, Ripple, Żyletka, Poślizg, Pióro, Rączka, Lupa, Tekst
- Edycja: przytnij, przesuń, ripple delete, wstaw/nadpisz z monitora źródła, podnieś/wyodrębnij, kopiuj/wklej/wklej atrybuty, duplikowanie Alt+przeciągnij, szybkość klipu, znaczniki, In/Out
- Ruch/krycie/kadrowanie z klatkami kluczowymi, tryby mieszania, manipulacja w monitorze programu
- Efekty GPU: rozmycie, wyostrzanie, poświata, mozaika, posteryzacja, krawędzie, płaskorzeźba, aberracja, ziarno, stroboskop, Ultra Key (green screen), lustro, drgania kamery i inne
- Lumetri: balans bieli (pipeta), ekspozycja, kontrast, światła, cienie, biele, czernie, nasycenie, jaskrawość, wygląd (LUT-y kreatywne), winieta, Auto
- Przejścia wideo (przenikanie, przez czerń/biel, wymazanie, przesłona, wsunięcie, wypchnięcie, zoom…) i audio (stała moc / stałe wzmocnienie)
- Tytuły i napisy z animacjami, warstwy korekcyjne, plansze koloru
- Audio: głośność/panorama klipów, efekty (bas, soprany, filtry, echo), mikser ścieżek, solo/mute, mierniki
- Cofnij/ponów z panelem Historia, autozapis, projekty `.tzproj`
- Eksport: MP4 H.264 (silnik C++ dokładny co do klatki lub w czasie rzeczywistym), WebM, WAV, PNG; presety YouTube/TikTok/Instagram

## Budowanie
```
python build.py --version 26.0.1 --installer-url https://.../TopaZ_Editing_Pro_26_Setup.exe --notes "Co nowego"
```
Wynik: `dist/TopaZ_Editing_Pro_26_Setup.exe` i `dist/manifest.json`.

## Aktualizacje przez TopaZ Creative Hub
1. Utwórz publiczne repozytorium (np. GitHub `topaz-releases`).
2. Zbuduj nową wersję (`build.py --version …`) i wgraj **instalator** oraz **manifest.json** jako pliki wydania (Release).
3. W TopaZ Creative Hub → Ustawienia wpisz adres manifestu, np.
   `https://github.com/<użytkownik>/topaz-releases/releases/latest/download/manifest.json`
   (albo podaj go przy budowaniu: `--manifest-url`, wtedy instalator ustawi go automatycznie).
4. Hub sprawdza aktualizacje co 6 h, pokazuje powiadomienie, pobiera instalator, weryfikuje SHA-256 i instaluje w tle (`/S`).

## Parametry instalatora
`/S` cicha instalacja · `/D=<folder>` folder · `/NOHUB` `/NODESKTOP` `/NOASSOC` `/NOSTARTMENU`
Deinstalacja: `Uninstall.exe /uninstall [/S]` lub Ustawienia Windows → Aplikacje.
