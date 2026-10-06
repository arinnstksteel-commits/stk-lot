-- 012: บันทึกว่าใครเติมเลขบิล / ชื่อลูกค้า (แยกจากคนตัดสต๊อค)
alter table public.stock_moves add column if not exists bill_by uuid references auth.users(id);
alter table public.stock_moves add column if not exists bill_at timestamptz;

create or replace function public.stock_moves_bill_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is distinct from old.doc_no or new.customer is distinct from old.customer then
    new.bill_by := auth.uid();
    new.bill_at := now();
  end if;
  return new;
end $$;
drop trigger if exists stock_moves_bill_stamp on public.stock_moves;
create trigger stock_moves_bill_stamp before update on public.stock_moves
  for each row execute function public.stock_moves_bill_stamp();
