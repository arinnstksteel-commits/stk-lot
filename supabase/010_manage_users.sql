-- 010: หน้าจัดการผู้ใช้ (แอดมินเท่านั้น)
-- ผู้ใช้สร้างใน Supabase > Authentication > Users แล้วมากำหนดชื่อ/บทบาทในแอป

create or replace function public.admin_list_users()
returns table (id uuid, username text, full_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_admin();
  return query
    select u.id, split_part(u.email, '@', 1)::text, p.full_name, p.role, u.created_at, u.last_sign_in_at
    from auth.users u left join public.profiles p on p.id = u.id
    order by (p.role is null) desc, p.role, u.email;
end $$;

-- p_role = null → ถอนสิทธิ์ (ล็อกอินได้แต่ไม่เห็นข้อมูล)
-- ตั้งได้แค่ ออฟฟิศ / คลัง · แก้บัญชีตัวเองไม่ได้ (กันแอดมินล็อกตัวเองออก)
create or replace function public.admin_set_user(p_id uuid, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_admin();
  if p_id = auth.uid() then raise exception 'แก้บัญชีของตัวเองไม่ได้'; end if;
  if exists (select 1 from profiles where id = p_id and role = 'admin') then raise exception 'แก้บัญชีแอดมินจากหน้านี้ไม่ได้'; end if;
  if p_role is null then delete from profiles where id = p_id; return; end if;
  if p_role not in ('office', 'warehouse') then raise exception 'บทบาทไม่ถูกต้อง'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'ใส่ชื่อเล่นพนักงาน'; end if;
  insert into profiles(id, full_name, role) values (p_id, trim(p_name), p_role)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_user(uuid, text, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user(uuid, text, text) to authenticated;
