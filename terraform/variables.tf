variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance size for staging."
  default     = "t3.small"
}

variable "key_name" {
  type        = string
  description = "Name of an existing EC2 key pair in this region (for SSH). Create one in EC2 console if needed."
}

variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed to SSH (e.g. your home IP/32). Use 0.0.0.0/0 only for quick tests."
  default     = "0.0.0.0/0"
}

variable "install_docker" {
  type        = bool
  description = "Run user-data to install and start Docker on Amazon Linux 2023."
  default     = true
}

variable "project_name" {
  type        = string
  description = "Prefix for resource Name tags."
  default     = "progress-tracker-staging"
}
