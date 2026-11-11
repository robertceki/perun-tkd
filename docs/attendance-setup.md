# Prisustvo — APP-S2 (A2)

## Primena i status

Migracija `supabase/migrations/20261110165932_attendance_app_s2.sql` je dodatak već primenjenoj `20261110111023_phase1_foundation.sql` (D1). D1 se ne menja. Novi fajl je prethodno generisan; ovaj zadatak ga samo popunjava. Samo roditeljski proces, posle pregleda, primenjuje migraciju na odobreno razvojno okruženje. Radnik nije izvršavao SQL, kreirao naloge niti menjao okruženje. Potrebni su postojeći `auth`, uloge `anon`/`authenticated`, privatna šema i D1 `btree_gist` ekstenzija. Primena treba da bude jedna transakcija. Pre primene proveriti rezervnu kopiju i stvarne D1 potpise/ograničenja.

**SQL izvršavanje, RLS, konkurentnost i vremenske granice još nisu potvrđeni na živoj bazi.** TypeScript/build nisu dokaz ispravnosti migracije. Ne primenjivati u produkciji na osnovu ovog dokumenta.

## TypeScript ugovor

Postojeći repository API ostaje. `load()` uvek učitava i vraća nizove `sessions` i `attendance` (paginacija po 500), bez lokalne/mock zamene. Polja su opciona samo u prelaznom `ClubData` tipu radi starih potrošača/fixture podataka. Greške servisa se prosleđuju; odsutna migracija se ne maskira praznim nizovima. Novi `TrainingSession` i `SessionAttendance` odgovaraju kolonama istoimenih SQL tabela `training_sessions` i `session_attendance`. `present` je boolean, početno `false`; treći status deteta ne postoji.

`WeeklyTerm` dodaje opciona nullable polja `created_by`, `updated_by`, `created_at`, `updated_at`. Stari `trainer_id` ostaje. Stari nepoznati autor i vreme ostaju `null`; odgovorni trener nije dokaz autorstva. `TermAssignment.cancelled_at` je opciono nullable.

| Repository metoda | SQL RPC i imenovani parametri | SQL povratna vrednost / TS |
| --- | --- | --- |
| `ensureSession(sessionDate, termId)` | `ensure_session(p_session_date date, p_term_id uuid)` | jedan composite `public.training_sessions` / `Promise<TrainingSession>` |
| `setPresence(sessionId, childId, present)` | `set_presence(p_session_id uuid, p_child_id uuid, p_present boolean)` | `void` / `Promise<void>` |
| `addSubstitute(sessionId, childId)` | `add_substitute(p_session_id uuid, p_child_id uuid)` | `void` / `Promise<void>` |
| `completeSession(sessionId)` | `complete_session(p_session_id uuid)` | `void` / `Promise<void>` |
| `cancelSession(sessionId)` | `cancel_session(p_session_id uuid)` | `void` / `Promise<void>` |
| `cancelEnrollment(termId, childId, validFrom)` | `cancel_enrollment(p_term_id uuid, p_child_id uuid, p_valid_from date)` | `void` / `Promise<void>` |
| `getServerTime()` | `get_server_time()` (bez parametara) | `timestamptz` / `Promise<string>` (ISO vremenski trenutak) |
| `saveTerm(term, assignments)` | postojeći `save_term(p_term jsonb, p_assignments jsonb)` | `void` / `Promise<void>` |
| `saveChild(child, contacts)` | nepromenjeni `save_child(p_child jsonb, p_contacts jsonb)` | `void` / `Promise<void>` |

Datumi su `YYYY-MM-DD`, vremena lokalnog rasporeda `HH:mm` ili SQL `HH:mm:ss`, timestamptz vrednosti su vremenski trenuci sa zonom/UTC pomakom. `formatTime(value)` prikazuje `HH:mm` i odbija neispravno vreme. `normalizeTermTime(value)` vraća `HH:mm:00` za validan novi unos sa nula sekundi ili `null`; odbija razlomljene/nenulte sekunde. Neizmenjene stare vrednosti sa sekundama ostaju čitljive i ne prepisuju se destruktivno. DB proverava nula sekundi kod novog/promenjenog rasporeda. `belgradeBusinessDate(instant?: Date)` vraća `YYYY-MM-DD` u zoni Europe/Belgrade. Klijentske i SQL provere datuma rođenja, završenih upisa, deaktiviranja i ponovnog upisa koriste datum u toj zoni. Klijentski sat i `getServerTime` služe informisanju; odluka o dozvoli uvek je DB.

Novi termin dobija autora od trenutnog aktivnog trenera. SQL prihvata izostavljen `trainer_id` i izvodi ga iz istog trenera; za izmenu izostavljen stari `trainer_id` se zadržava. Postojeći obavezni TS `trainer_id` ostaje radi kompatibilnosti starih potrošača; novi potrošač može slati prazan string kroz repository, koji ga izostavlja iz RPC JSON-a. Nije potreban izbor odgovornog trenera u budućem UI-ju. Klijentski autor/editor/vreme nisu pouzdani i trigger ih prepisuje ili odbija. Trigger metapodataka radi pre stare validacije termina.

## Snimci i vreme

`unique(term_id, session_date)` i zajednička transakciona advisory brava obezbeđuju jedan kanonski trening pri konkurentnim pozivima. RPC prvo traži postojeći trening, zatim samo prvi put pravi snimak grupe/naziva, početka/kraja i spiska dece. Ponovno otvaranje vraća postojeći snimak, uključujući otkazan trening. Budući pregled koristi nedeljni raspored bez kreiranja snimka. Proveravaju se ISO dan nedelje i uključivi period termina. Neaktivnost ili kasniji prelazak deteta/grupe ne brišu upisnu istoriju prilikom pravljenja prošlog treninga. Ime deteta/grupe se snima u trenutku prvog kreiranja, jer D1 nema istoriju promena imena.

DB računa `starts_at_utc = (session_date + starts_at) AT TIME ZONE 'Europe/Belgrade'`. DST pravila su PostgreSQL pravila zone (uključujući izbor trenutka kod dvosmislenog/nepostojećeg lokalnog vremena). Ne koristi se zona uređaja. Primeri za proveru: 2026-01-05 18:00 → 17:00Z; 2026-07-06 18:00 → 16:00Z; proveriti i prelaze 2026-03-29 i 2026-10-25.

`ensure_session` i direktan INSERT odbijaju kreiranje dok je serverski `clock_timestamp()` strogo manji od kanonskog početka. Tačno na početku i kasnije, uključujući prošle termine, kreiranje je dozvoljeno. Trigger izračunava početak pre provere i snimanja spiska.

Prisustvo, dodavanje zamene, završetak i otkazivanje treninga odbijaju se pre sačuvanog početka. Završetak postavlja `completed_at`, ne zaključava kasnije ispravke prisustva/zamene. Otkazivanje postavlja `cancelled_at`; zatim su prisustvo, zamene i završetak zabranjeni. Ponovni završetak/otkazivanje već tako označenog treninga je idempotentno (završetak otkazanog treninga ipak je greška). Ne postoji brisanje istorije ni poništavanje završetka/otkazivanja.

Zamena mora biti stvarno postojeće aktivno dete. Jedinstven ključ `(session_id, child_id)` sprečava duplikate. Ponovno dodavanje postojećeg deteta vraća uspeh bez resetovanja prisustva ili promene `is_substitute`; budući/otkazani trening i tada odbija zahtev. Početni spisak ima `is_substitute=false`, zamena `true`, oba početno `present=false`. Polja snimka i autora su zaštićena i pri direktnom REST upisu. Direktan INSERT treninga takođe snima kanonske vrednosti i početni spisak; direktan naknadni INSERT prisustva dozvoljava samo aktivnu zamenu posle početka. DELETE nije dodeljen.

## Otkazivanje upisa

Identitet je tačno `(term_id, child_id, valid_from)`. Otkazivanje postavlja serverski `cancelled_at`, ne menja `valid_to`, čak ni ako upis počinje u budućnosti. Ponovljeni poziv je idempotentan. Sačuvani trening/spisak se ne menja. Pri prvom kreiranju treninga upis važi ako datum pripada uključivom periodu i `cancelled_at IS NULL OR cancelled_at > starts_at_utc`. Otkazivanje posle početka zato ne briše podobnost za raniji trening; tačno na početku više nije podoban.

Otkazan red je nepromenljiv. `save_term` ga čuva i kada je izostavljen ili klijent pokuša da pošalje `cancelled_at=null`, drugi timestamp ili promenjen kraj. Novi/živi red ne može da podmetne otkazivanje preko `save_term`; koristi se posebna radnja. Direktni REST prelaz živog reda u otkazan koristi isključivo serversko vreme, bez promene identiteta/perioda. Istorijski otkazan red ne blokira deaktiviranje/pomeranje deteta; živi sadašnji/budući upis i dalje blokira neodgovarajuće promene.

**Ponovni upis je novi red**, sa novim `valid_from` koji mora biti posle lokalnog datuma otkazivanja prethodnih upisa tog deteta u taj termin. Stari identitet se nikada ne aktivira. GiST zabrana preklapanja i dalje potpuno važi između svih živih redova; otkazani red ostaje istorija. Ponovni upis u isti kalendarski dan nije podržan. Pravila vrste/aktivnosti grupe, aktivnog deteta/trenera i perioda ostaju za novi upis. Stara zabrana promene povezanog rasporeda i obuhvata istorije ostaje.

## Bezbednost i provera roditelja

Nove javne tabele imaju RLS i zajednički pristup samo aktivnim trenerima. `anon` nema grantove, autentikovani netrener ne prolazi proveru. Ne koristi se `user_metadata`. Postojeća privatna provera članstva izbegava rekurziju trainer politike. Svi javni RPC-ovi su `SECURITY INVOKER` sa praznim fiksnim `search_path`; EXECUTE nije dodeljen PUBLIC/anon. Privatni audit trigger je uski `SECURITY DEFINER`, ponovo izvodi trenera iz `auth.uid()`, ima zaključan path i nema klijentski EXECUTE. Privatni audit nema klijentske SELECT/INSERT/UPDATE/DELETE grantove, ima RLS i zabranu izmene/brisanja. Ne postoji audit-write RPC; beleže se insert/update treninga, prisustva, termina i upisa, sa pre/posle vrednostima i serverskim akterom/vremenom.

Zajednička brava se uzima u BEFORE STATEMENT triggerima za relevantne tabele i u RPC-ovima pre čitanja/zaključavanja. Time se serijalizuju snimanje i otkazivanje, uključujući direktne REST upise. Ovo je nameran kompromis za jedan klub, ne dizajn za visok paralelni promet. Stari `save_child` API ostaje isti, njegovo pisanje prolazi istu bravu.

Roditelj/Raphael treba da uradi sledeće na **izričito odobrenom test okruženju**, uz postojeće odobrene test identitete (bez automatskog kreiranja naloga):

1. U transakciji primeniti D1 + A2 na izolovanu test bazu ili A2 na potvrđen D1. Proveriti potpise, grantove, RLS, triggere, upit kataloga za nepostojanje PUBLIC EXECUTE nad novim funkcijama. Pokrenuti advisors. Za rollback test: `BEGIN`, primena, testovi sa savepoint-ima i očekivanim greškama, `ROLLBACK`; zatim potvrditi da nema novih tabela/kolona. Posle stvarno potvrđene primene ne brisati istoriju radi rollback-a: povratak rezervne kopije u izolovanu bazu ili posebno pregledana forward migracija.
2. Kao aktivni trener: novi termin bez odgovornog trenera; podmetnut autor/vreme; legacy red sa null autorom; save_child/save_term regresije. Novi unos nenultih sekundi mora pasti, postojeće neizmenjene sekunde ostati. Proveriti direktni REST, ne samo RPC.
3. Kao anon, autentikovani netrener i neaktivni trener: SELECT/INSERT/UPDATE novih tabela i svi RPC-ovi moraju biti odbijeni ili vratiti nula vidljivih redova; probe audit INSERT/UPDATE/DELETE/EXECUTE i pokušaj samododele trainer članstva moraju pasti.
4. Dva nezavisna konkurentna poziva ensure za isti par daju isti ID, jedan trening i isti jedinstven spisak. Izmena rasporeda/naziva/dečjih podataka posle kreiranja ne menja snimak. Ponovno otvaranje ne dodaje trenutnu decu. Pogrešan weekday/van perioda mora pasti.
5. Budući trening: `ensure_session` i direktan INSERT sa podmetnutim prošlim `starts_at_utc` padaju. Potvrditi da nema snimka, spiska ni audit zapisa. Proveriti pre, tačno na i posle početka, kao i da ponovljeni ensure vraća isti snimak posle otkazivanja. Prošli trening: default false, true/false ispravke, završetak, kasne ispravke i aktivna zamena rade; duplikat ne resetuje stanje. Otkazan trening: svi attendance pozivi i direktni REST pokušaji padaju; ponovljeno otkazivanje čuva timestamp.
6. Otkazati budući upis, proveriti da nema `valid_to<valid_from`, red je sačuvan i dete može biti deaktivirano/pomereno tek kada nema drugih živih upisa. Pokušati uncancel, spoof timestamp, promenu identiteta i preklop dva živa upisa. Novi upis posle datuma otkazivanja radi, stari se ne vraća. Kreirati prošli trening posle otkazivanja i kasnijeg pomeranja/deaktiviranja: upis otkazan posle njegovog početka mora ostati podoban. Raniji konkretan spisak mora ostati isti.
7. U dva konekcijska toka testirati cancel-vs-presence i ensure-vs-enrollment-cancel; stanje mora odgovarati jednom serijskom redosledu. Proveriti audit aktera, vremena i pre/posle, kao i nedostupnost audita običnom treneru. Testirati početnu granicu, Belgrade ponoć i DST nezavisno od zone uređaja. Test ne sme menjati klijentski sat kao dokaz DB dozvole.

Dokumentacioni oslonac: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [changelog](https://supabase.com/changelog) pregledani tokom rada. Dostupni skoriji breaking change za Flutter ne menja ovaj PostgreSQL/supabase-js ugovor. Live SQL provere iznad ostaju pending do nezavisnog roditeljskog izvršavanja.

## Lokalno izvršene provere radnika

- `npm run typecheck`: exit 0.
- `npm run build`: exit 0 (Vite 5.4.21).
- `npm run lint`: exit 1, nula grešaka i dve nasleđene `react-hooks/exhaustive-deps` cleanup-ref opomene: `src/hooks/useAuth.ts:59` (`sequence.current`) i `src/hooks/useClubData.ts:30` (`generation.current`). `--max-warnings 0` ih čini neuspehom. M1 ih rešava; A2 ne menja te fajlove.
- `npm run test`: exit 1, `No test files found`; R1 naknadno autoruje testove. Ovo nije prolaz testova.
- Lokalni `psql`, `postgres` i `supabase` nisu pronađeni u PATH-u; nije instaliran paket niti pokretan SQL. Provere baze ostaju pending.

`saveTerm` u TS prihvata i ulaz bez `trainer_id` (postojeći puni `WeeklyTerm` i dalje odgovara); prazan string takođe izostavlja iz JSON-a da bi DB izveo trenutnog trenera. Prikaz stare SQL vrednosti može čitati i razlomljene sekunde, ali novi/promenjeni unos ih odbija.
- Završni in-memory Node/TypeScript check: exit 0; provereni HH:mm/HH:mm:ss normalizacija, odbijanje neispravnih/nenultih/razlomljenih novih vremena, čitljivost legacy sekundi, i razlika otkazanog naspram živog upisa u klijentskom guard-u deteta. Nije kreiran test fajl. Posle završnih TS izmena typecheck/build ponovo exit 0; završni lint ponovo exit 1 samo zbog iste dve nasleđene opomene.
