-- Let bootcamp admins read profiles of members in bootcamps they administer
-- (needed for TeachersCard profile join when listing teachers).
CREATE POLICY "Bootcamp admins read member profiles" ON public.profiles
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bootcamp_members admin_m
    JOIN public.bootcamp_members member_m ON admin_m.bootcamp_id = member_m.bootcamp_id
    WHERE admin_m.user_id = auth.uid()
      AND public.is_bootcamp_admin(auth.uid(), admin_m.bootcamp_id)
      AND member_m.user_id = profiles.id
  )
);

-- Backfill teacher memberships for accepted invites that never created bootcamp_members rows.
INSERT INTO public.bootcamp_members (bootcamp_id, user_id, role)
SELECT DISTINCT bid, i.accepted_user_id, i.role
FROM public.invites i
CROSS JOIN LATERAL unnest(i.bootcamp_ids) AS bid
WHERE i.status = 'accepted'
  AND i.accepted_user_id IS NOT NULL
  AND i.role = 'teacher'
ON CONFLICT (bootcamp_id, user_id) DO NOTHING;

-- Also backfill when accepted_user_id was not recorded but the profile exists by email.
INSERT INTO public.bootcamp_members (bootcamp_id, user_id, role)
SELECT DISTINCT bid, p.id, i.role
FROM public.invites i
CROSS JOIN LATERAL unnest(i.bootcamp_ids) AS bid
JOIN public.profiles p ON lower(p.email) = lower(i.email)
WHERE i.status = 'accepted'
  AND i.accepted_user_id IS NULL
  AND i.role = 'teacher'
ON CONFLICT (bootcamp_id, user_id) DO NOTHING;
