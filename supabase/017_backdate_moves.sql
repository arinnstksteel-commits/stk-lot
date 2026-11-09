-- 017: ตัดสต๊อคย้อนหลังได้ (เฉพาะแอดมิน)
-- entered_at = เวลาที่กดบันทึกจริงเสมอ ส่วน created_at = วันที่ของรายการ (แอดมินเลือกย้อนหลังได้)
alter table public.stock_moves add column if not exists entered_at timestamptz not null default now();
drop trigger if exists stock_moves_date_guard on public.stock_moves;
update public.stock_moves set entered_at = created_at;  -- รายการเก่าไม่รู้เวลากดจริง ใช้วันที่รายการแทน

create or replace function public.stock_moves_date_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.entered_at := now();
    if new.created_at is null then new.created_at := now(); end if;
    -- คนที่ไม่ใช่แอดมิน ลงวันที่เองไม่ได้ (ใช้เวลาปัจจุบันเสมอ)
    if coalesce(public.my_role(), '') <> 'admin' and auth.uid() is not null then
      new.created_at := now();
    end if;
    if new.created_at > now() + interval '5 minutes' then
      raise exception 'ลงวันที่ล่วงหน้าไม่ได้';
    end if;
  else
    new.entered_at := old.entered_at;
    if new.created_at is distinct from old.created_at and coalesce(public.my_role(), '') <> 'admin' then
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists stock_moves_date_guard on public.stock_moves;
create trigger stock_moves_date_guard before insert or update on public.stock_moves
  for each row execute function public.stock_moves_date_guard();
