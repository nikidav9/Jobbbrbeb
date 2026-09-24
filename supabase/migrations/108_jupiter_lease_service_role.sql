-- Jupiter worker calls jupiter_lease_task through PostgREST with the
-- service-role key. Earlier migrations revoked EXECUTE from PUBLIC but did
-- not grant it back to service_role, so every lease RPC failed with HTTP 500.
grant execute on function public.jupiter_lease_task(text, integer) to service_role;
