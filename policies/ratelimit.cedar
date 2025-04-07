// Default rate limit: standard tier for everyone
permit(
  principal,
  action == Action::"ratelimit",
  resource == Gateway::Endpoint::"rate-tier:standard"
);

// Enterprise tenants get premium rate limit tier
permit(
  principal is Gateway::Tenant,
  action == Action::"ratelimit",
  resource == Gateway::Endpoint::"rate-tier:premium"
)
when { principal.tier == "enterprise" };
