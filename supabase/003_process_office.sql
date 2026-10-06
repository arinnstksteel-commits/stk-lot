-- 003: งานส่ง process (ตัด / เจาะ / ขัด) เป็นหน้าที่ออฟฟิศ
-- คลังยังเห็นรายการได้ แต่ส่งงานและบันทึกรับคืนได้เฉพาะ admin + office

drop policy if exists write_jobs  on public.process_jobs;
drop policy if exists update_jobs on public.process_jobs;

create policy write_jobs  on public.process_jobs for insert to authenticated
  with check (public.my_role() in ('admin','office'));
create policy update_jobs on public.process_jobs for update to authenticated
  using (public.my_role() in ('admin','office'));
