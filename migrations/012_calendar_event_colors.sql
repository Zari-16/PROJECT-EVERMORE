-- Persist the selected event swatch for the monthly calendar.
alter table public.calendar_events
  add column if not exists color text not null default '#773f91';

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.calendar_events'::regclass
       and conname = 'calendar_events_color_check'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_color_check
      check (color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end;
$block$;

grant insert (color) on table public.calendar_events to authenticated;
grant update (color) on table public.calendar_events to authenticated;