// All authenticated users can access public API endpoints
permit(
  principal is Gateway::User,
  action == Action::"access",
  resource in Gateway::Service::"public-api"
);

// API keys can access public API endpoints
permit(
  principal is Gateway::ApiKey,
  action == Action::"access",
  resource in Gateway::Service::"public-api"
);

// Admin users can access admin endpoints
permit(
  principal is Gateway::User,
  action == Action::"access",
  resource in Gateway::Service::"admin-service"
)
when { principal.role == "admin" };

// Block suspended tenants
forbid(
  principal,
  action == Action::"access",
  resource
)
when { context.tenantStatus == "suspended" };
