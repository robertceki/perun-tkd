# Podešavanje prve faze

Projekat koristi React 18.3.1, Vite 5.4.21 i TypeScript 5.9.3. Bootstrap je 5.3.8, a Supabase klijent 2.117.3. Ovaj zadatak priprema izvorni kod; roditeljski proces naknadno pokreće `npm install` i sinhronizuje `package-lock.json`. Radnik ne instalira zavisnosti.

Posle instalacije: `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Za pregledničke provere roditelj instalira Playwright Chromium (`npx playwright install chromium`), zatim pokreće `npm run test:e2e`. Vitest koristi jsdom i `tests/setup.ts`; Playwright koristi `tests/e2e` i lokalni Vite server. Raphael naknadno piše testove: odsustvo testova nije uspešna provera ponašanja. Nove konfiguracije ulaze u strogu TypeScript proveru.

## Konfiguracija

Potrebna su imena `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY`; stariji javni ključ može koristiti `VITE_SUPABASE_ANON_KEY`. Vrednosti se podešavaju odvojeno, bez objavljivanja u repozitorijumu. Nikada ne stavljati `service_role` ili tajni ključ u frontend. Nepostojeća ili neispravna konfiguracija daje `supabase = null` i `repository = null`; aplikacija treba da prikaže objašnjenje. Nema lokalnog skladištenja poslovnih podataka niti lažne prijave. Supabase čuva i obnavlja autentifikacionu sesiju.

U Supabase Auth isključiti javnu registraciju. Site URL i dozvoljeni Redirect URLs moraju odgovarati stvarnom poreklu aplikacije; lokalno odobriti `http://localhost:5173/` i, kada se koristi Playwright, `http://127.0.0.1:5173/`. Oporavak šalje povratni URL `${window.location.origin}/`; interfejs treba da obradi `PASSWORD_RECOVERY` i pozove `updatePassword`. Slanje zahteva šalje pravi imejl: radnik ovo ne izvršava.

`loadAuthorizedSession()` i `signInTrainer(email,password)` vraćaju `{session,trainer}`. Aktivno članstvo u tabeli `trainers`, povezano preko `user_id`, obavezno je. Neovlašćena sesija se lokalno odjavljuje i funkcija odbija pristup. Ostali izvozi: `signOutTrainer()`, `requestPasswordReset(email)`, `updatePassword(password)` i `subscribeToAuthChanges(callback)`, koji vraća funkciju za odjavu pretplate. Callback prima `(event,session)` u odloženom pozivu, van Supabase auth zaključavanja; interfejs zatim proverava članstvo. Sam događaj prijave nije dokaz ovlašćenja. RLS je autoritativna zaštita svakog zahteva.

## Migracija i ovlašćenja

Jedini artefakt je `supabase/migrations/20261110111023_phase1_foundation.sql`, prethodno napravljen CLI alatom. Radnik ga ne primenjuje. Roditelj pregleda migraciju i zavisnost `btree_gist` (za zabranu preklapanja intervala), potvrđuje ciljni razvojni projekat i tek zatim primenjuje odobrenim postupkom. Migracija ne briše postojeće objekte, ne pravi naloge, ne dodaje trenere i ne sadrži početne podatke. Ako navedene tabele već postoje, zaustaviti primenu i usaglasiti stanje; ne zaobilaziti greške destruktivnim SQL-om. Šema `tkd_private` ne sme biti među Data API exposed schemas.

Sve javne tabele imaju RLS. Aktivni treneri dele podatke kluba. Anonimni korisnici i prijavljeni korisnici bez aktivnog članstva nemaju pristup. Klijent ima samo SELECT nad trenerima; ne može dodeliti sebi članstvo. Jedini SECURITY DEFINER pomoćnik je `tkd_private.is_active_trainer()`: bez parametara, zaključan search_path, provera tekućeg `auth.uid()`, EXECUTE samo za authenticated. Ostale funkcije su SECURITY INVOKER sa zaključanim search_path. Promena članstva ostaje kontrolisana administrativna operacija van aplikacije.

Pre prihvatanja roditelj/Raphael proveravaju anoniman pristup, prijavljenog korisnika bez članstva, neaktivnog trenera i aktivnog trenera, kao i pokušaj samododele ovlašćenja, RLS direktno nad tabelama i oba RPC-a. Proveriti odbijanje neispravnih grupa, datuma, glavnih kontakata i preklapanja, atomsku povratnu promenu pri grešci, čuvanje završenih upisa i konkurentne izmene. Lokalne provere i mock testovi ne dokazuju ove uslove u stvarnoj bazi.

## Ugovor podataka i RPC

UUID identifikatore pravi interfejs. Datumi su ISO `YYYY-MM-DD`, dani 1–7 (ponedeljak–nedelja), vreme `HH:mm` ili `HH:mm:ss`. Periodi važenja uključuju oba kraja; null završetak znači otvoren period. Novi upis posle zatvaranja prethodnog počinje najranije narednog dana. Dete ima jednu glavnu i najviše jednu takmičarsku grupu. Telefon i datum rođenja su obavezni; imejl i adresa kontakta mogu biti null, adresa i pojas deteta mogu biti prazni. Kontakt se čuva jednom i povezuje sa više dece. Tačno jedan kontakt deteta mora biti glavni.

`createClubRepository(client)` pravi repozitorijum; `repository` je nullable singleton. `load()` vraća `ClubData` (trainers, groups, contacts, children, childContacts, terms, assignments), uz paginaciju svih tabela. `saveContact(Contact)` i `saveGroup(Group)` rade upsert i prosleđuju greške. Ne menjaju povezane podatke. `saveChild(Child,ChildContact[])` poziva `public.save_child(p_child jsonb,p_contacts jsonb)`; niz sadrži veze ka prethodno sačuvanim kontaktima, ne nove kontakte. Dete i konačan komplet njegovih veza čuvaju se atomskom transakcijom. `saveTerm(WeeklyTerm,TermAssignment[])` poziva `public.save_term(p_term jsonb,p_assignments jsonb)`.

Upisi se identifikuju sa `(term_id,child_id,valid_from)`. RPC unosi nove i eksplicitno menja završetak postojećih; izostavljeni upisi ostaju sačuvani. Za završavanje upisa poslati isti ključ i konkretan `valid_to`; prazna lista ništa ne briše. Već završeni upisi su nepromenljivi. Preklapajući periodi istog deteta u istom terminu su zabranjeni. Upis mora biti unutar važenja termina. Za proširenje postojećeg perioda termina prvo sačuvati proširen termin, potom proširene upise. Sužavanje može istovremeno da zatvori upise. Ne menjati grupu, dan, vreme, trenera ili početak termina sa upisima: završiti postojeći i napraviti novi termin. Za promenu grupe ili deaktivaciju deteta prvo završiti njegove tekuće/buduće upise zaključno sa prethodnim danom. Istorijski upisi ostaju povezani sa originalnim terminom i ne prepisuju se prema novoj grupi. Deaktivacija grupa/trenera ne briše istoriju.

Čisti validatori `validateContact`, `validateGroup`, `validateChild` i `validateTerm` vraćaju niz poruka na srpskom. Server dodatno proverava invarijante nezavisno od interfejsa. Za uređivanje termina proslediti i postojeće upise koji ostaju relevantni. Greške repozitorijuma treba prikazati korisniku bez tvrdnje da je neuspešno čuvanje uspelo.

## Odloženi koraci

Prvi stvarni trener i provera stvarne prijave su odloženi. Ovlašćeni administrator će, uz posebno odobrenje, napraviti/proveriti Auth nalog i povezati njegov UUID sa aktivnim redom u `trainers`. Ne dodeljivati pristup postojećim nalozima automatski. Nema javnog signup-a, roditeljskih naloga ni samostalnog dodavanja trenera.

Klub ima jednu fiksnu lokaciju. Naziv/adresa još nisu dostavljeni: interfejs prikazuje da lokacija nije podešena; ne izmišljati stvarnu adresu niti uvoditi više lokacija.
