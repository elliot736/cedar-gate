// Route user endpoints to the users service
permit(
  principal,
  action == Action::"route",
  resource == Gateway::Endpoint::"GET:/api/users"
);

permit(
  principal,
  action == Action::"route",
  resource == Gateway::Endpoint::"POST:/api/users"
);

// Route admin endpoints (only admin users, enforced by access policy)
permit(
  principal,
  action == Action::"route",
  resource in Gateway::Service::"admin-service"
);
