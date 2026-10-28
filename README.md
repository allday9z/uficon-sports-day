# 👟 Sports Day UFicon 2026 — แบบฟอร์มเสื้อกีฬา

Employees fill in one form each: employee code, full name, the team colour they drew (ฟ้า / ชมพู / เขียว), the nickname printed on the shirt, a 2-digit back number and the shirt size (polo chart 2S–7XL).

- **Jersey numbers never repeat.** The form shows live whether a number is free and has a 00–99 picker. The server checks again inside a transaction under an advisory lock, so two people sending the same number at once can't both get it. The admin chooses the scope: the whole company (default) or per colour.
- **One form per employee code.** Later changes go through the organiser.
- **Organiser page `/admin`:** counts per colour, size × colour totals for ordering, search/filter, edit/delete, open/close the form, Excel export (all, size summary, one sheet per colour; numbers kept as text, so `07` stays `07`).

## Admin password
Set `ADMIN_SETUP_CODE` in the runtime env. The first visit to `/admin` uses it once to create the organiser's own password. After that the code no longer works.

## Run
```
DATABASE_URL=postgres://… ADMIN_SETUP_CODE=… PORT=3000 bun src/server.ts
TEST_DATABASE_URL=postgres://…/empty_test_db bun test
```
Tables are prefixed `sd_` (shared Postgres) and are created on start.

Future questions: add them to `src/data.ts` (`cleanEntry`) and the form; the `sd_entries.extra` JSONB column is reserved for them.
