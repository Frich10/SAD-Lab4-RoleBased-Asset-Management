
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  role        text not null default 'requester'
              check (role in ('admin','staff','requester')),
  created_at  timestamptz not null default now()
);

create table if not exists public.equipment (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text,
  status      text not null default 'Available'
              check (status in ('Available','Borrowed','Maintenance','Damaged')),
  created_at  timestamptz not null default now()
);

create table if not exists public.borrowing_transactions (
  id             bigint generated always as identity primary key,
  equipment_id   bigint not null references public.equipment(id),
  requester_id   uuid   not null references public.profiles(id),
  approver_id    uuid   references public.profiles(id),
  status         text not null default 'Pending'
                 check (status in ('Pending','Approved','Rejected','Released','Returned','Overdue','Closed')),
  purpose        text,
  is_damaged     boolean not null default false,
  request_date   timestamptz not null default now(),
  approved_date  timestamptz,
  released_date  timestamptz,
  return_date    timestamptz,
  notes          text
);

create table if not exists public.maintenance_requests (
  id             bigint generated always as identity primary key,
  equipment_id   bigint not null references public.equipment(id),
  requested_by   uuid   not null references public.profiles(id),
  description    text not null,
  status         text not null default 'Open'
                 check (status in ('Open','In Progress','Resolved')),
  created_at     timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id),
  action       text not null,
  module       text not null,
  record_id    text,
  description  text,
  created_at   timestamptz not null default now()
);

create or replace function public.current_role_name()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'requester');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.enforce_new_request()
returns trigger
language plpgsql
security definer
as $$
declare
  eq_status text;
  req_role  text;
begin
  select status into eq_status from public.equipment where id = new.equipment_id;
  if eq_status is null then
    raise exception 'Equipment does not exist';
  end if;
  if eq_status <> 'Available' then
    raise exception 'BR-A4-01/09: Equipment is not available for borrowing (current status: %)', eq_status;
  end if;

  req_role := public.current_role_name();
  if req_role = 'requester' and new.requester_id <> auth.uid() then
    raise exception 'Requesters may only submit requests for themselves';
  end if;

  new.status := 'Pending';
  new.approver_id := null;
  return new;
end;
$$;

drop trigger if exists trg_new_request on public.borrowing_transactions;
create trigger trg_new_request
  before insert on public.borrowing_transactions
  for each row execute function public.enforce_new_request();

create or replace function public.enforce_borrowing_rules()
returns trigger
language plpgsql
security definer
as $$
declare
  role text;
begin
  if old.status = new.status then
    return new; 
  end if;

  role := public.current_role_name();

  if new.status = 'Approved' or new.status = 'Rejected' then

    if role <> 'admin' then
      raise exception 'BR-A4-03: Only an Administrator may approve or reject requests';
    end if;

    if old.requester_id = auth.uid() then
      raise exception 'BR-A4-02: You cannot approve or reject your own request';
    end if;
    if old.status <> 'Pending' then
      raise exception 'Only Pending requests can be approved or rejected';
    end if;
    new.approver_id := auth.uid();
    new.approved_date := now();

  elsif new.status = 'Released' then
    if role not in ('admin','staff') then
      raise exception 'Only Administrator or Staff may release equipment';
    end if;

    if old.status <> 'Approved' then
      raise exception 'BR-A4-04: Only Approved requests may be released';
    end if;
    new.released_date := now();

    update public.equipment set status = 'Borrowed' where id = new.equipment_id;

  elsif new.status = 'Returned' then
    if role not in ('admin','staff') then
      raise exception 'Only Administrator or Staff may process returns';
    end if;

    if old.status <> 'Released' then
      raise exception 'BR-A4-08: Only Released equipment can be returned (or it was already processed)';
    end if;
    new.return_date := now();

    update public.equipment
      set status = case when new.is_damaged then 'Damaged' else 'Available' end
      where id = new.equipment_id;

  elsif new.status = 'Overdue' then
    if role not in ('admin','staff') then
      raise exception 'Only Administrator or Staff may flag overdue items';
    end if;
    if old.status <> 'Released' then
      raise exception 'Only Released equipment can become Overdue';
    end if;

  elsif new.status = 'Closed' then
    if role not in ('admin','staff') then
      raise exception 'Only Administrator or Staff may close a transaction';
    end if;
    if old.status not in ('Returned') then
      raise exception 'Only a Returned transaction can be Closed';
    end if;

  else
    raise exception 'Unsupported status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_borrowing_rules on public.borrowing_transactions;
create trigger trg_borrowing_rules
  before update on public.borrowing_transactions
  for each row execute function public.enforce_borrowing_rules();

create or replace function public.enforce_maintenance()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    update public.equipment set status = 'Maintenance' where id = new.equipment_id;
  elsif tg_op = 'UPDATE' and new.status = 'Resolved' and old.status <> 'Resolved' then
    update public.equipment set status = 'Available' where id = new.equipment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_maintenance on public.maintenance_requests;
create trigger trg_maintenance
  before insert or update on public.maintenance_requests
  for each row execute function public.enforce_maintenance();

create or replace function public.log_borrowing_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), 'SUBMITTED', 'Borrowing', new.id::text,
            'Borrowing request submitted for equipment #' || new.equipment_id);
  elsif tg_op = 'UPDATE' and old.status <> new.status then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), upper(new.status), 'Borrowing', new.id::text,
            'Status changed from ' || old.status || ' to ' || new.status ||
            ' for transaction #' || new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_borrowing on public.borrowing_transactions;
create trigger trg_audit_borrowing
  after insert or update on public.borrowing_transactions
  for each row execute function public.log_borrowing_audit();

create or replace function public.log_maintenance_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.audit_logs(user_id, action, module, record_id, description)
  values (auth.uid(), 'MAINTENANCE_' || upper(tg_op), 'Maintenance', new.id::text,
          coalesce(new.description, 'Maintenance status: ' || new.status));
  return new;
end;
$$;

drop trigger if exists trg_audit_maintenance on public.maintenance_requests;
create trigger trg_audit_maintenance
  after insert or update on public.maintenance_requests
  for each row execute function public.log_maintenance_audit();

create or replace function public.log_equipment_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), 'CREATED', 'Equipment', new.id::text, 'Added equipment: ' || new.name);
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), 'UPDATED', 'Equipment', new.id::text,
            'Equipment ' || new.name || ' status ' || old.status || ' -> ' || new.status);
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), 'DELETED', 'Equipment', old.id::text, 'Removed equipment: ' || old.name);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_equipment on public.equipment;
create trigger trg_audit_equipment
  after insert or update or delete on public.equipment
  for each row execute function public.log_equipment_audit();

create or replace function public.log_role_change_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  if old.role <> new.role then
    insert into public.audit_logs(user_id, action, module, record_id, description)
    values (auth.uid(), 'ROLE_CHANGE', 'Users', new.id::text,
            'Role changed from ' || old.role || ' to ' || new.role || ' for ' || new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_role on public.profiles;
create trigger trg_audit_role
  after update on public.profiles
  for each row execute function public.log_role_change_audit();

alter table public.profiles              enable row level security;
alter table public.equipment             enable row level security;
alter table public.borrowing_transactions enable row level security;
alter table public.maintenance_requests  enable row level security;
alter table public.audit_logs            enable row level security;


create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.current_role_name() = 'admin');

create policy "profiles_update_own_name"
  on public.profiles for update
  using (id = auth.uid() or public.current_role_name() = 'admin');


create policy "equipment_select_all_authenticated"
  on public.equipment for select
  using (auth.uid() is not null);

create policy "equipment_admin_manage"
  on public.equipment for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');


create policy "borrowing_select_own_or_staff_admin"
  on public.borrowing_transactions for select
  using (
    requester_id = auth.uid()
    or public.current_role_name() in ('admin','staff')
  );

create policy "borrowing_insert_requester_or_staff"
  on public.borrowing_transactions for insert
  with check (
    public.current_role_name() in ('admin','staff','requester')
  );

create policy "borrowing_update_staff_admin_only"
  on public.borrowing_transactions for update
  using (public.current_role_name() in ('admin','staff'))
  with check (public.current_role_name() in ('admin','staff'));


create policy "maintenance_select_staff_admin"
  on public.maintenance_requests for select
  using (public.current_role_name() in ('admin','staff'));

create policy "maintenance_insert_staff_admin"
  on public.maintenance_requests for insert
  with check (public.current_role_name() in ('admin','staff'));

create policy "maintenance_update_staff_admin"
  on public.maintenance_requests for update
  using (public.current_role_name() in ('admin','staff'));


create policy "audit_select_admin_only"
  on public.audit_logs for select
  using (public.current_role_name() = 'admin');

insert into public.equipment (name, category, status) values
  ('Laptop LAP-001', 'Computers', 'Available'),
  ('Projector PRJ-010', 'AV Equipment', 'Available'),
  ('Multimeter MTR-004', 'Lab Instruments', 'Available'),
  ('Oscilloscope OSC-002', 'Lab Instruments', 'Available')
on conflict do nothing;
