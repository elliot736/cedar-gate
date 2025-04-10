# S3 bucket for Cedar policies and entities
resource "aws_s3_bucket" "policies" {
  bucket = "${var.project}-${var.environment}-policies"

  tags = { Name = "${var.project}-${var.environment}-policies" }
}

resource "aws_s3_bucket_versioning" "policies" {
  bucket = aws_s3_bucket.policies.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "policies" {
  bucket = aws_s3_bucket.policies.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "policies" {
  bucket                  = aws_s3_bucket.policies.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Upload initial policy files and entities from the repo
resource "aws_s3_object" "entities" {
  bucket = aws_s3_bucket.policies.id
  key    = "entities.json"
  source = "${path.module}/../../entities.json"
  etag   = filemd5("${path.module}/../../entities.json")

  tags = { Name = "entities-json" }
}
