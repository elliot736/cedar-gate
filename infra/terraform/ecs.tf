# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${var.project}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.project}-${var.environment}-cluster" }
}

# CloudWatch log group
resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/ecs/${var.project}-${var.environment}/gateway"
  retention_in_days = var.log_retention_days
}

# ECS Task Execution Role (for pulling images, writing logs)
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project}-${var.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS Task Role (for the running containers - S3 access for policies)
resource "aws_iam_role" "ecs_task" {
  name = "${var.project}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "s3-policy-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:ListBucket",
      ]
      Resource = [
        aws_s3_bucket.policies.arn,
        "${aws_s3_bucket.policies.arn}/*",
      ]
    }]
  })
}

# Gateway Task Definition
resource "aws_ecs_task_definition" "gateway" {
  family                   = "${var.project}-${var.environment}-gateway"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "gateway"
    image = "${aws_ecr_repository.gateway.repository_url}:latest"

    portMappings = [
      {
        containerPort = 8080
        protocol      = "tcp"
      },
      {
        containerPort = 8081
        protocol      = "tcp"
      },
    ]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "TRAFFIC_PORT", value = "8080" },
      { name = "ADMIN_PORT", value = "8081" },
      { name = "POLICIES_DIR", value = "/app/policies" },
      { name = "ENTITIES_FILE", value = "/app/entities.json" },
      { name = "POLICIES_S3_BUCKET", value = aws_s3_bucket.policies.id },
      { name = "AWS_REGION", value = var.aws_region },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.gateway.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "gateway"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }

    essential = true
  }])
}

# Gateway Service
resource "aws_ecs_service" "gateway" {
  name            = "${var.project}-${var.environment}-gateway"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = var.gateway_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.traffic.arn
    container_name   = "gateway"
    container_port   = 8080
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.admin.arn
    container_name   = "gateway"
    container_port   = 8081
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  depends_on = [aws_lb_listener.traffic, aws_lb_listener.admin]
}
