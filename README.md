<p align="center">
  <img src="logo.png" width="128" alt="TopaZ Creative Hub">
</p>

<h1 align="center">TopaZ Creative Hub</h1>

<p align="center">
  Jedno miejsce do instalowania i aktualizowania programów TopaZ.<br>
  <b>Windows 10 / 11 (64-bit)</b> · wersja 26.2 · ok. 1 MB
</p>

<p align="center">
  <a href="https://github.com/TopaZ-Hub/TopaZ-HUB/raw/main/TopaZ_Creative_Hub_Setup.exe"><b>⬇️ Pobierz TopaZ Creative Hub</b></a>
</p>

---

## Co to jest?

**TopaZ Creative Hub** to mały program, przez który instalujesz i aktualizujesz aplikacje TopaZ. Działa podobnie do Adobe Creative Cloud.

Obecnie dostępne:

| Program | Opis |
|---|---|
| **TopaZ Editing Pro 26** | Edytor wideo w stylu Premiere Pro: oś czasu, 90+ efektów GPU, 30+ przejść, korekcja kolorów Lumetri i szybki eksport sprzętowy H.264 / H.265 / AV1 do 4K i 8K |
| **TopaZ Effects 26** | Animacja i efekty wizualne w stylu After Effects: warstwy 3D, kamery, wyrażenia, maski, track matte, wtyczki i Dynamic Link z Editing |

## Instalacja krok po kroku

1. Pobierz **`TopaZ_Creative_Hub_Setup.exe`** (link wyżej).
2. Uruchom plik. Jeśli pojawi się czerwone okno **„System Windows ochronił ten komputer”**:
   - kliknij **„Więcej informacji”**,
   - potem **„Uruchom mimo to”**.

   Skąd to okno, wyjaśniam w sekcji niżej.
3. Przejdź przez instalator: **Dalej → Akceptuję → Zainstaluj**. Uprawnienia administratora nie są potrzebne.
4. W Hubie kliknij **„Zainstaluj”** przy programie, który chcesz (TopaZ Editing Pro 26 lub TopaZ Effects 26).
5. Gotowe. O nowych wersjach Hub powiadomi Cię sam, a aktualizację instalujesz jednym kliknięciem.

## ⚠️ Dlaczego Windows pokazuje czerwone ostrzeżenie?

To okno **nie oznacza, że wykryto wirusa**. Windows pokazuje je przy każdym pliku, który:

- **nie ma płatnego certyfikatu podpisu cyfrowego**. Dlatego w oknie jest napis „Nieznany wydawca”. Taki certyfikat kosztuje kilkaset złotych rocznie, a TopaZ to mały, niezależny projekt, który na razie go nie ma;
- **jest nowy i pobrało go jeszcze niewiele osób**. Windows ufa plikom stopniowo, w miarę jak uruchamia je więcej ludzi.

Takie samo okno widzi prawie każdy mały, darmowy program od niezależnego twórcy. Kiedy projekt dostanie certyfikat, ostrzeżenie zniknie.

Zamiast wierzyć mi na słowo, możesz to sam sprawdzić:

### 1. Sprawdź plik na VirusTotal

Wejdź na **[virustotal.com](https://www.virustotal.com)** i wrzuć plik instalatora. Sprawdzi go ponad 60 programów antywirusowych naraz.

### 2. Porównaj sumę kontrolną

Dzięki niej upewnisz się, że to dokładnie ten plik, a nie podmieniony. W PowerShellu wpisz:

```powershell
Get-FileHash .\TopaZ_Creative_Hub_Setup.exe -Algorithm SHA256
```

Wynik musi być taki sam jak ten:

```
1C02E62398F9D7EAB69F915FFF09B838A736FB8C0922C38E906E633DB40DF5AC
```

### 3. Co program robi na komputerze

- ✅ Instaluje się tylko w Twoim folderze użytkownika (`%LocalAppData%\Programs\TopaZ`). Nie potrzebuje uprawnień administratora.
- ✅ Łączy się wyłącznie z GitHubem: pobiera listę aplikacji i instalatory z wydań [TopaZ-Editing-Pro](https://github.com/TopaZ-Hub/TopaZ-Editing-Pro).
- ✅ Każdy pobrany instalator sprawdza sumą **SHA-256**. Uszkodzony albo podmieniony plik nie zostanie uruchomiony.
- ✅ Nie zbiera danych, nie wyświetla reklam, nie instaluje dodatków.
- ✅ Twoje filmy i projekty nigdy nie są wysyłane do internetu.
- ✅ Odinstalujesz go normalnie: **Ustawienia → Aplikacje → TopaZ Creative Hub → Odinstaluj**.

## Pytania

**Hub uruchamia się razem z Windows. Mogę to wyłączyć?**
Tak. W Hubie wejdź w **Ustawienia** i odznacz automatyczne uruchamianie.

**Antywirus blokuje plik.**
To się zdarza z programami bez certyfikatu. Sprawdź plik na VirusTotal (wyżej). Jeśli wszystko jest w porządku, dodaj wyjątek w antywirusie.

**Coś nie działa.**
Napisz w zakładce **[Issues](https://github.com/TopaZ-Hub/TopaZ-HUB/issues)**. Dodaj zrzut ekranu i opis, co robiłeś.

---

<p align="center"><sub>© 2026 TopaZ · Projekt niezależny, niezwiązany z Adobe ani Microsoft.</sub></p>
