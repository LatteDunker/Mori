output "elastic_ip" {
  description = "Stable public IP for DNS and bookmarks."
  value       = aws_eip.staging.public_ip
}

output "instance_id" {
  value = aws_instance.staging.id
}

output "ssh_command" {
  description = "SSH as ec2-user (Amazon Linux 2023)."
  value       = "ssh -i /path/to/your-key.pem ec2-user@${aws_eip.staging.public_ip}"
}
