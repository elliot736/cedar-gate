output "traffic_url" {
  description = "Gateway traffic URL (port 80 -> 8080)"
  value       = "http://${aws_lb.main.dns_name}"
}

output "admin_url" {
  description = "Gateway admin/metrics URL (port 8081)"
  value       = "http://${aws_lb.main.dns_name}:8081"
}

output "ecr_repo" {
  description = "ECR repository URL for the gateway"
  value       = aws_ecr_repository.gateway.repository_url
}

output "policies_bucket" {
  description = "S3 bucket name for Cedar policies and entities"
  value       = aws_s3_bucket.policies.id
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.gateway.name
}

output "sns_topic_arn" {
  description = "SNS topic ARN for alarms"
  value       = aws_sns_topic.alerts.arn
}
