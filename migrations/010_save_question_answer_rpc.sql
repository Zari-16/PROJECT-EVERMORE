-- Save answers through a validated RPC instead of granting direct table writes.
revoke insert, update on table public.question_answers from authenticated;
revoke insert (space_id, question_date, author, answer, visibility)
  on table public.question_answers from authenticated;
revoke update (answer, visibility)
  on table public.question_answers from authenticated;

create or replace function public.save_question_answer(
  p_space_id uuid,
  p_question_date date,
  p_answer text,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_answer is null or pg_catalog.char_length(pg_catalog.btrim(p_answer)) not between 1 and 5000 then
    raise exception 'Answer must contain 1 to 5000 characters';
  end if;
  if p_visibility not in ('private', 'shared', 'after_both') then
    raise exception 'Invalid answer visibility';
  end if;
  if not public.is_space_member(p_space_id, v_user) then
    raise exception 'You are not a member of this shared space';
  end if;
  if not exists (
    select 1 from public.daily_questions as daily
     where daily.space_id = p_space_id
       and daily.question_date = p_question_date
  ) then
    raise exception 'That daily question is not available in this space';
  end if;

  insert into public.question_answers (space_id, question_date, author, answer, visibility)
  values (p_space_id, p_question_date, v_user, pg_catalog.btrim(p_answer), p_visibility)
  on conflict (space_id, question_date, author) do update
    set answer = excluded.answer,
        visibility = excluded.visibility;
end;
$function$;

revoke all on function public.save_question_answer(uuid, date, text, text) from public, anon;
grant execute on function public.save_question_answer(uuid, date, text, text) to authenticated;