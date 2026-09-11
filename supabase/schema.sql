-- 육진대 맵 회원 데이터. Supabase SQL 편집기에 그대로 붙여 넣는다.
--
-- 여기 들어오는 것은 "기기를 옮겨도 따라와야 하는 것"뿐이다.
-- 장소·축제·코스는 여전히 노션에 있다 — 운영진이 노션에서 직접 편집하기 때문이다.

create table if not exists public.favorites (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  place_id   text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- 찜 목록은 "최근 찜한 순"으로 읽는다. 브라우저 시절 배열 맨 앞에 넣던 것과 같은 순서다.
create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

-- 노션 페이지 ID 형식만 받는다. 브라우저 localStorage 는 사용자가 직접 고칠 수 있어서,
-- 거기서 온 값을 그대로 믿으면 아무 문자열이나 테이블에 쌓인다.
alter table public.favorites
  add constraint favorites_place_id_format
  check (place_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- 프론트가 Supabase 를 직접 부른다. 그래서 행 단위 보안이 유일한 방어선이다 —
-- 여기를 켜지 않으면 anon 키를 가진 누구나 남의 찜을 읽고 지울 수 있다.
alter table public.favorites enable row level security;

create policy "자기 찜만 본다"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "자기 찜만 추가한다"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "자기 찜만 지운다"
  on public.favorites for delete
  using (auth.uid() = user_id);

-- 한 사람이 들고 갈 수 있는 찜의 상한. 전국 장소가 257곳이라 500이면 넉넉하고,
-- 상한이 없으면 한 번의 요청으로 테이블을 부풀릴 수 있다.
create or replace function public.check_favorites_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.favorites where user_id = new.user_id) >= 500 then
    raise exception '찜은 500개까지 저장할 수 있어요.';
  end if;
  return new;
end;
$$;

drop trigger if exists favorites_limit on public.favorites;
create trigger favorites_limit
  before insert on public.favorites
  for each row execute function public.check_favorites_limit();
