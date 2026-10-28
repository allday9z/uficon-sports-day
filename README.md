# 👟 Sports Day UFicon 2026 — แบบฟอร์มเสื้อกีฬา

Employees fill in one form each (and can edit it later): employee code (4 digits, e.g. 0000), full name, the team colour they drew (ฟ้า / ชมพู / เขียว), the nickname printed on the shirt, a 2-digit back number and the shirt size (polo chart 2S–7XL).

- **Jersey numbers never repeat.** The form shows live whether a number is free and has a 00–99 picker. The server checks again inside a transaction under an advisory lock, so two people sending the same number at once can't both get it. The admin chooses the scope: the whole company (default) or per colour.
- **One form per employee code.** Later changes go through the organiser.
- **Organiser page `/admin`:** counts per colour, size × colour totals for ordering, search/filter, edit/delete, open/close the form, Excel export (all, size summary, one sheet per colour; numbers kept as text, so `07` stays `07`).

## Organiser link (no password)
The organiser opens `/admin/<ADMIN_LINK_TOKEN>` (runtime env). Opening it signs that browser in for 120 days and shows `/admin`. Anyone with the link can manage the data, so it is never shared with employees. To revoke it, change the env value and delete the rows in `sd_sessions`.

## Members per colour (`/teams`)
The draw list (`sd_members`): ID, title, first name, last name, nickname, branch, colour. The organiser pastes rows straight from Excel on `/admin`. The first list is loaded once from `MEMBERS_SEED_B64` (base64 TSV, runtime env only), so names never land in this public repo. When an employee types a code that is on the list, the form fills in the name and colour, and the server refuses a different colour.

## Editing an answer
Each employee code can send one form. The browser that sent it keeps a private edit key, so that person can edit their own answer while the form is open. Another device gets "already sent".

## Run
```
DATABASE_URL=postgres://… ADMIN_LINK_TOKEN=… PORT=3000 bun src/server.ts
TEST_DATABASE_URL=postgres://…/empty_test_db bun test
```
Tables are prefixed `sd_` (shared Postgres) and are created on start.

Future questions: add them to `src/data.ts` (`cleanEntry`) and the form; the `sd_entries.extra` JSONB column is reserved for them.
