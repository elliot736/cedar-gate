variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "cedar-gate"
}

variable "gateway_cpu" {
  description = "Gateway task CPU units"
  type        = number
  default     = 512
}

variable "gateway_memory" {
  description = "Gateway task memory (MB)"
  type        = number
  default     = 1024
}

variable "gateway_desired_count" {
  description = "Number of gateway tasks"
  type        = number
  default     = 2
}

variable "gateway_max_count" {
  description = "Maximum number of gateway tasks for autoscaling"
  type        = number
  default     = 10
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection on ALB and S3"
  type        = bool
  default     = true
}

variable "admin_cidr_blocks" {
  description = "CIDR blocks allowed to access the admin port (8081)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications (optional)"
  type        = string
  default     = ""
}
