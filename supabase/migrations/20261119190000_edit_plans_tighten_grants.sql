-- Signed-in users only need select/insert/update/delete (all behind row level
-- security). TRUNCATE ignores row level security, so it is removed.
revoke truncate, references, trigger on public.edit_plans from authenticated;
