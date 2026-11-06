# Overtime Tracker

A web app that lets staff log the hours they worked each week, and gives managers a single view of everyone's hours that they can export to Excel.

Before this, collecting hours meant chasing people for times and copying them into a spreadsheet by hand. Now each person marks their own hours on a weekly grid, and an admin downloads the whole team's week in one click.

<!-- Live site: add your Vercel link here -->
<!-- ![Weekly schedule grid](docs/schedule.png) -->

## Features

### For staff
- **Secure sign-in** with email and password
- **Schedule view:** a weekly grid in 15-minute blocks, from midnight to midnight. Click a block to mark it, or click and drag to mark a whole shift. Works with touch on phones too.
- **Manual view:** type in start and end times for each day instead of dragging
- **Live summary:** shows your shifts for each day and your total hours as you go
- **Save and come back:** your hours for the week reload the next time you sign in

### For admins
- **Everyone's hours this week:** a card for each person with their shifts and daily and weekly totals
- **Copy all as spreadsheet:** copies the whole team's week so you can paste it straight into Excel or Google Sheets
- **Download as Excel (.xlsx):** exports the same table as a ready-to-use Excel file

<!-- ![Admin view](docs/admin.png) -->

## How It Works

- Weeks run **Saturday to Friday**, and the app always opens on the current week.
- Each block on the grid is stored as a day and a 15-minute slot. When you save, the app sends the list of blocks you marked to Supabase.
- The app merges neighboring blocks into shifts (for example, 9:00 AM to 5:00 PM) and adds up the totals.
- Each person has one saved record per week, so saving again updates that week instead of making a copy.
- An `is_admin` flag on each person's profile decides who sees the team view.

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | HTML, CSS, JavaScript (no framework, no build step) |
| Backend | Supabase (PostgreSQL and Auth) |
| Excel export | SheetJS (xlsx) |
| Hosting | Vercel |

## Setup

### 1. Create the database

In your Supabase project, open the **SQL Editor** and run:

```sql
-- Each person's name and admin status
create table if not exists public.profiles (
  id       uuid primary key references auth.users (id) on delete cascade,
  name     text,
  is_admin boolean not null default false
);

-- One row per person per week
create table if not exists public.weekly_hours (
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text,
  week_start date not null,
  selections text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Checks whether the signed-in user is an admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

alter table public.profiles enable row level security;
alter table public.weekly_hours enable row level security;

-- People see their own profile; admins see everyone's
create policy "read own profile or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- People see and save only their own hours; admins can see everyone's
create policy "read own hours or admin" on public.weekly_hours
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "add own hours" on public.weekly_hours
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own hours" on public.weekly_hours
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 2. Add your team

The app has no sign-up page, so accounts are created by an admin:

1. In Supabase, go to **Authentication > Users** and add each person with an email and password.
2. In the `profiles` table, add a row for each person with their user ID and name.
3. Set `is_admin` to `true` for anyone who should see the whole team's hours.

### 3. Connect the app

Open `config.js` and paste in your Supabase **Project URL** and **anon (publishable) key**. Both are found under your project's settings. The anon key is meant to be public, and the security rules above are what protect the data.

### 4. Run it

There's nothing to install. Open `index.html` in your browser, or serve the folder with any static server:

```bash
npx serve .
```

To put it online, deploy the folder to [Vercel](https://vercel.com) or any static host.

## Project Structure

```
index.html   The whole app: layout, styles, and logic
config.js    Your Supabase URL and anon key
```
