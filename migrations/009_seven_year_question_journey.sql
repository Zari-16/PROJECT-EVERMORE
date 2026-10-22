-- Expand the starter bank into a deterministic seven-year long-distance couple journey.
alter table public.question_bank
  add column if not exists journey_day integer,
  add column if not exists progression_year integer,
  add column if not exists depth text not null default 'light';

create unique index if not exists question_bank_journey_day_uidx
  on public.question_bank(journey_day) where journey_day is not null;

create table if not exists public.question_journey_starts (
  space_id uuid primary key references public.private_spaces(id) on delete cascade,
  start_date date not null
);

alter table public.question_journey_starts enable row level security;
revoke all privileges on table public.question_journey_starts from anon, public, authenticated;

insert into public.question_journey_starts (space_id, start_date)
select space.id, (space.created_at at time zone 'UTC')::date
  from public.private_spaces as space
on conflict (space_id) do nothing;

with phases as (
  select * from (values
    (1, 'Getting to know each other', 'gentle',
      array[
        'your everyday routines', 'little comforts at home', 'your morning rhythm', 'your evening rhythm', 'the music you reach for',
        'foods that feel familiar', 'small ways you celebrate', 'what makes you laugh', 'your ideal relaxed weekend', 'the way you like to plan a day',
        'places you enjoy nearby', 'activities you like doing alone', 'activities you enjoy sharing online', 'your favorite kind of message', 'what makes a video call comfortable',
        'the pace you like for texting', 'how you like to say goodnight', 'the kind of surprise you enjoy', 'what helps a visit feel welcoming', 'things you like showing on camera',
        'your favorite season', 'a hobby you could talk about for ages', 'what helps you recharge', 'little things that make a place feel cozy', 'what you hope I notice about you'
      ]::text[],
      array['Getting to know you','Daily life','Daily life','Daily life','Favorites','Favorites','Traditions','Playfulness','Daily life','Daily life','Places and visits','Independence','Shared activities','Communication','Long-distance connection','Communication','Affection','Affection','Visits and travel','Long-distance connection','Favorites','Interests','Wellbeing','Daily life','Feeling seen']::text[],
      array[
        'What is something you genuinely enjoy about %s?',
        'What did you like about %s the first time it came into your life?',
        'What does a relaxed, ordinary moment with %s look like for you?',
        'How does %s fit into the rhythm of your week?',
        'What is one small detail about %s that makes you smile?',
        'How would you share %s with me from a distance?',
        'What would you choose first if we explored %s together?',
        'What makes %s feel comfortable rather than stressful?',
        'What is something you are curious to ask me about %s?',
        'Is there a simple ritual around %s you would enjoy sharing?',
        'What does your ideal version of %s feel like?',
        'What is one thing about %s that you wish people noticed?',
        'Which part of %s feels most like you?',
        'What could make %s easier for you when we are apart?',
        'If you described %s in three words, which would you choose and why?'
      ]::text[]),
    (2, 'Stories, memories, and identity', 'open',
      array[
        'the place you grew up', 'family traditions you remember', 'a childhood friendship', 'a school memory that stayed with you', 'a time you felt brave as a kid',
        'a move or change that shaped you', 'the first place that felt like home', 'a tradition you chose for yourself', 'a relative who influenced you', 'a childhood comfort object',
        'a song tied to an earlier chapter', 'a moment you changed your mind', 'a past version of your dream', 'a friendship you learned from', 'a time you felt misunderstood',
        'a moment someone showed up for you', 'a memory of being welcomed', 'a place you still miss', 'a story you tell about yourself', 'a part of your background you want me to know',
        'an achievement you once overlooked', 'a time you had to start over', 'a lesson from a past relationship or friendship', 'a memory that changed what home means', 'the first impression you had of me'
      ]::text[],
      array['Childhood','Family and traditions','Friendship','Growing up','Growing up','Change and distance','Home','Identity','Family','Childhood','Memories','Growth','Dreams','Friendship','Feeling understood','Support','Belonging','Places and visits','Identity','Background','Growth','Resilience','Learning','Home','Our story']::text[],
      array[
        'What is a memory connected to %s that you still think about?',
        'What did %s teach you about the person you were becoming?',
        'How has your perspective on %s changed over time?',
        'What detail about %s do you wish you could show me rather than describe?',
        'What feeling comes up when you share %s with me?',
        'What did you need from others during %s?',
        'What would you want your younger self to know about %s?',
        'How does %s influence what you want to build with someone now?',
        'Is there anything about %s you understand differently today?',
        'What part of %s would you like me to ask you more about?',
        'How could we make room for %s in our long-distance conversations?',
        'What did you learn about belonging through %s?',
        'Which part of %s feels important to carry forward?',
        'Does %s bring up anything you would rather approach gently?',
        'What would feeling fully heard about %s look like to you?'
      ]::text[]),
    (3, 'Communication, needs, and affection', 'reflective',
      array[
        'how you prefer to receive reassurance', 'what makes a call feel connecting', 'how you like to handle delayed replies', 'your preferred way to bring up a concern', 'what helps you feel listened to',
        'how you express affection from far away', 'the kind of check-in that feels caring', 'what you need after a hard day', 'how you signal that you need space', 'what makes an apology meaningful',
        'how you like to celebrate good news together', 'the balance you want between calls and messages', 'what helps you feel included in daily life', 'the way you ask for support', 'how you prefer to receive feedback',
        'what helps during a timezone mismatch', 'how you like to reconnect after a busy week', 'what makes a virtual date feel present', 'the kind of affection that feels natural to you', 'what helps you talk when you feel nervous',
        'how you prefer to make plans together', 'what makes you feel remembered', 'the difference between advice and listening for you', 'what helps a difficult conversation feel safe', 'the signs that you are feeling close to me'
      ]::text[],
      array['Reassurance','Communication','Communication','Communication','Feeling heard','Affection at a distance','Connection across distance','Emotional support','Boundaries','Repair','Celebrating together','Long-distance rhythm','Everyday connection','Support','Communication','Time zones','Reconnection','Virtual dates','Affection','Vulnerability','Planning','Feeling remembered','Support','Emotional safety','Closeness']::text[],
      array[
        'What do you wish I understood about %s before I try to respond?',
        'What is one small thing I could do that would help with %s?',
        'How can we talk about %s without either of us feeling blamed?',
        'What does a good moment of %s feel like in your body or mood?',
        'What has worked well for you around %s, even if it seems small?',
        'What tends not to help when %s is difficult?',
        'How would you like us to handle %s when our schedules do not line up?',
        'What would you like to ask me about my experience of %s?',
        'What boundary or agreement might make %s easier for both of us?',
        'When %s is going well, what are we each doing that helps?',
        'What is one experiment we could try around %s for a week?',
        'How can we repair things kindly if we misunderstand each other about %s?',
        'What part of %s feels easy to say, and what part feels harder?',
        'How could we make space for both of our needs around %s?',
        'What would you like us to remember about %s during a busy or lonely week?'
      ]::text[]),
    (4, 'Trust, values, and healthy boundaries', 'thoughtful',
      array[
        'what trust looks like in everyday choices', 'privacy in a relationship', 'friendships outside the relationship', 'social media boundaries', 'what commitment means to you',
        'how you balance togetherness and independence', 'how you prefer to make shared decisions', 'what honesty feels like when the truth is awkward', 'the values you want a relationship to reflect', 'what counts as a broken agreement',
        'how you want jealousy handled', 'the difference between privacy and secrecy', 'how to respect each other’s time', 'what makes a promise realistic', 'how you define emotional safety',
        'what you need to feel secure while apart', 'how you want to handle attention from others', 'what personal goals should stay your own', 'how you want family involved in our relationship', 'what respect sounds like during disagreement',
        'which expectations should be discussed rather than assumed', 'how you think about money and fairness', 'how to handle different comfort levels', 'what would make a boundary feel caring rather than controlling', 'the principles you want us to return to when uncertain'
      ]::text[],
      array['Trust','Privacy','Friendship','Digital boundaries','Commitment','Independence','Decisions','Honesty','Values','Agreements','Jealousy','Trust','Time and care','Commitment','Emotional safety','Long-distance security','Boundaries','Independence','Family','Respect','Expectations','Fairness','Boundaries','Healthy boundaries','Shared values']::text[],
      array[
        'What does %s mean in practice, not just in principle?',
        'Where might our assumptions about %s differ?',
        'What would be a fair agreement for both of us around %s?',
        'How can we revisit %s if one of us changes over time?',
        'What would help you raise a concern about %s early and kindly?',
        'How could distance make %s feel more complicated?',
        'What part of %s feels non-negotiable for you, and why?',
        'Where is there room for flexibility around %s?',
        'What would respecting both people look like with %s?',
        'What is a question we should answer together before making assumptions about %s?',
        'How would you like me to respond if you feel uneasy about %s?',
        'What does accountability look like when we handle %s poorly?',
        'What would a healthy middle ground around %s feel like?',
        'How can we protect closeness without losing ourselves around %s?',
        'What shared value could guide us when %s is hard to navigate?'
      ]::text[]),
    (5, 'Repair, resilience, and emotional support', 'deep but gentle',
      array[
        'what loneliness feels like for you', 'a missed call or changed plan', 'how you experience conflict from a distance', 'what helps after a misunderstanding', 'the way stress changes your communication',
        'how you want an apology to be followed up', 'what you need when you feel disconnected', 'how to discuss a recurring issue', 'what makes you shut down in a hard talk', 'how to reconnect after hurt feelings',
        'the role of patience in our relationship', 'what you want me to do when I cannot fix a problem', 'how to handle disappointment about a visit', 'what would help during a long stretch without seeing each other', 'what you do when worry starts to spiral',
        'how we can talk about unmet needs', 'the signs that one of us needs a pause', 'what forgiveness does and does not mean to you', 'what support looks like when we are both tired', 'how to make amends across time zones',
        'what you learned from a difficult season', 'how to notice resentment before it grows', 'what makes it safe to be imperfect together', 'how to ask for comfort without feeling like a burden', 'what helps you believe we can work through a hard week'
      ]::text[],
      array['Loneliness','Plans and distance','Conflict','Repair','Stress','Apologies','Disconnection','Recurring patterns','Hard conversations','Repair','Resilience','Support','Visits and disappointment','Long-distance resilience','Anxiety and care','Needs','Pausing well','Forgiveness','Mutual support','Repair across distance','Growth','Repair','Emotional safety','Comfort','Hope']::text[],
      array[
        'What would you want me to know before we try to solve %s?',
        'What kind of support feels helpful, and what kind does not, around %s?',
        'What is a gentle first step we could take when %s happens?',
        'What do you need to hear after %s has been hard?',
        'How can we own our part in %s without turning it into a scorecard?',
        'What might help us pause and return to %s with more care?',
        'What would repair look like to you after %s?',
        'How could we make a plan for %s that still leaves room for real life?',
        'What part of %s is yours to work on, and what part should we handle together?',
        'What boundary would help keep %s from becoming hurtful?',
        'What do you appreciate about how we have handled %s so far?',
        'How could I check in about %s without pressuring you to answer immediately?',
        'What would make it easier to tell me when %s is building up?',
        'Is there a small ritual that could help us reconnect after %s?',
        'What do you want us to remember about each other while working through %s?'
      ]::text[]),
    (6, 'Future plans and closing the distance gently', 'forward-looking',
      array[
        'what a realistic visit rhythm could look like', 'how we want to plan visits fairly', 'what helps a visit feel restful rather than rushed', 'how to handle travel costs without shame', 'what each of us needs before considering a move',
        'career goals that affect where we live', 'family responsibilities that shape our options', 'how we would choose a place to live', 'what timeline feels hopeful but not pressured', 'what we need to learn before making a major decision',
        'how we imagine ordinary life in the same place', 'what independence should look like after closing the distance', 'how we can share planning work', 'what support we might need from friends or family', 'how to revisit a plan when circumstances change',
        'what home would mean in a shared place', 'how to protect personal goals during a move', 'how we would divide household responsibilities', 'what financial conversations we should have early', 'how to balance adventure with stability',
        'what kind of community we each need', 'how to make a long-term plan without pretending to know everything', 'what would make a visit accessible and comfortable', 'how to celebrate progress before a big milestone', 'what we want our relationship to feel like five years from now'
      ]::text[],
      array['Visits','Visit planning','Visits','Money and fairness','Closing distance','Careers','Family and care','Where to live','Timing','Decision-making','Shared life','Independence','Planning together','Support networks','Changing plans','Home','Personal growth','Shared responsibilities','Money and fairness','Adventure','Community','Future planning','Accessible visits','Milestones','Future together']::text[],
      array[
        'What would a kind, practical first conversation about %s include?',
        'What information would help us make a grounded decision about %s?',
        'What part of %s feels exciting, and what part feels uncertain?',
        'How can we discuss %s without treating one person’s needs as more important?',
        'What is one small step toward %s that does not commit us to a final decision?',
        'What options around %s should we keep open for now?',
        'How might distance, money, work, or family affect %s?',
        'What would a fair compromise about %s look like?',
        'What do you want to preserve about your own life while we explore %s?',
        'How would we know it is time to revisit %s?',
        'What would make %s feel sustainable, not just exciting at first?',
        'What help could we ask for while figuring out %s?',
        'Which assumption about %s should we check rather than rely on?',
        'What does “ready enough” mean to you when thinking about %s?',
        'How can we hold hope about %s without putting pressure on either of us?'
      ]::text[]),
    (7, 'Shared meaning, rituals, and long-term care', 'reflective and intimate',
      array[
        'the rituals that keep us connected across distance', 'how our idea of closeness has changed', 'the ways we have learned to repair', 'what makes our relationship feel like ours', 'the traditions we want to carry forward',
        'how we want to keep dating each other over time', 'what kind of support we want to be known for', 'the balance of novelty and routine we enjoy', 'what we want to celebrate each year', 'how we can protect curiosity about each other',
        'what we have built despite living apart', 'the ways we have grown individually and together', 'what home means to each of us now', 'how we want to handle future seasons of distance', 'what makes commitment feel alive to you',
        'the kind of legacy we want our partnership to create', 'what we want to keep learning about each other', 'how we can stay tender during ordinary weeks', 'what forgiveness and accountability look like for us now', 'how we want to make decisions as a team',
        'the small promises that matter most', 'what we want our future selves to remember', 'how we define a good life together', 'what needs to stay flexible as we change', 'the parts of our story we are proud to share'
      ]::text[],
      array['Rituals across distance','Growth','Repair','Identity as a couple','Traditions','Long-term affection','Mutual care','Shared life','Celebrations','Curiosity','Resilience','Growth','Home','Long-distance future','Commitment','Meaning','Curiosity','Everyday affection','Repair and accountability','Partnership','Promises','Reflection','Shared values','Change','Our story']::text[],
      array[
        'What do you hope %s continues to give us as life changes?',
        'How could we make %s feel nourishing in an ordinary month?',
        'What have you learned about yourself through %s?',
        'What part of %s would you like us to keep choosing intentionally?',
        'How has %s changed since the beginning of our relationship?',
        'What would you like our future selves to thank us for about %s?',
        'Where might %s need to evolve as we grow?',
        'What is one story about %s that captures something true about us?',
        'How can we make room for both gratitude and difficulty when we talk about %s?',
        'What would you like to keep discovering about me through %s?',
        'What does care look like around %s when neither of us has much energy?',
        'What belief about %s have you softened or strengthened over time?',
        'What promise about %s feels meaningful because it is realistic?',
        'How can we keep %s mutual rather than letting one person carry it?',
        'What is one thing about %s you want us to revisit together next year?'
      ]::text[])
  ) as phase(progression_year, phase_name, depth, topics, categories, templates)
), generated as (
  select
    phase.progression_year,
    phase.depth,
    phase.categories[template.template_number] as category,
    pg_catalog.format(template.template_text, topic.topic_text) as prompt,
    pg_catalog.row_number() over (
      partition by phase.progression_year
      order by topic.topic_number, template.template_number
    ) as day_in_year
  from phases as phase
  cross join lateral pg_catalog.unnest(phase.topics) with ordinality as topic(topic_text, topic_number)
  cross join lateral pg_catalog.unnest(phase.templates) with ordinality as template(template_text, template_number)
)
insert into public.question_bank (prompt, category, enabled, journey_day, progression_year, depth)
select
  generated.prompt,
  generated.category,
  true,
  ((generated.progression_year - 1) * 365 + generated.day_in_year)::integer,
  generated.progression_year,
  generated.depth
from generated
where generated.day_in_year <= 365
on conflict (prompt) do update
  set category = excluded.category,
      enabled = true,
      journey_day = excluded.journey_day,
      progression_year = excluded.progression_year,
      depth = excluded.depth;

insert into public.question_bank (prompt, category, enabled, journey_day, progression_year, depth) values
  ('On an extra-long year, what small connection ritual would you want us to keep?', 'Leap-day reflection', true, 2556, 7, 'reflective and intimate'),
  ('What is one thing about our long-distance story you hope we will laugh about years from now?', 'Leap-day reflection', true, 2557, 7, 'reflective and intimate')
on conflict (journey_day) where journey_day is not null do update
  set prompt = excluded.prompt,
      category = excluded.category,
      enabled = true,
      progression_year = excluded.progression_year,
      depth = excluded.depth;

create table if not exists public.question_journey_starts (
  space_id uuid primary key references public.private_spaces(id) on delete cascade,
  start_date date not null
);

alter table public.question_journey_starts enable row level security;
revoke all privileges on table public.question_journey_starts from anon, public, authenticated;

insert into public.question_journey_starts (space_id, start_date)
select space.id, (now() at time zone 'UTC')::date
  from public.private_spaces as space
on conflict (space_id) do nothing;

drop function if exists public.get_today_question();
create function public.get_today_question()
returns table (
  question_date date,
  question_id uuid,
  prompt text,
  category text,
  progression_year integer,
  depth text,
  journey_day integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_today date := pg_catalog.timezone('UTC', now())::date;
  v_start_date date;
  v_journey_day integer;
  v_question_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening daily questions'; end if;

  insert into public.question_journey_starts (space_id, start_date)
  values (v_space_id, v_today)
  on conflict (space_id) do nothing;

  select journey.start_date into v_start_date
    from public.question_journey_starts as journey
   where journey.space_id = v_space_id;

  v_journey_day := v_today - v_start_date + 1;
  if v_journey_day > 2557 then
    v_journey_day := ((v_journey_day - 1) % 2557) + 1;
  end if;

  select bank.id into v_question_id
    from public.question_bank as bank
   where bank.journey_day = v_journey_day
     and bank.enabled;
  if not found then raise exception 'No question is scheduled for journey day %', v_journey_day; end if;

  insert into public.daily_questions (space_id, question_date, question_id)
  values (v_space_id, v_today, v_question_id)
  on conflict on constraint daily_questions_pkey do update
    set question_id = excluded.question_id
    where not exists (
      select 1 from public.question_answers as answer
       where answer.space_id = excluded.space_id
         and answer.question_date = excluded.question_date
    );

  return query
    select daily.question_date, bank.id, bank.prompt, bank.category,
           coalesce(bank.progression_year, ((v_journey_day - 1) / 365) + 1),
           coalesce(bank.depth, 'light'),
           coalesce(bank.journey_day, v_journey_day)
      from public.daily_questions as daily
      join public.question_bank as bank on bank.id = daily.question_id
     where daily.space_id = v_space_id and daily.question_date = v_today;
end;
$function$;

grant execute on function public.get_today_question() to authenticated;
