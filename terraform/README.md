# Staging EC2 + Elastic IP (Terraform)

Provisions one Amazon Linux 2023 instance in the **default VPC**, a security group (SSH, 80, 443, 4000, 9101), and an **Elastic IP** attached to the instance.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS credentials for your Terraform IAM user (e.g. profile `terraform-mori` from `aws configure --profile terraform-mori`)
- An **EC2 key pair** in the target region (same name you put in `terraform.tfvars`)

## Quick start

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: key_name, aws_region, ssh_cidr (recommended: your IP/32)

export AWS_PROFILE=terraform-mori   # or your profile name
terraform init
terraform plan
terraform apply
```

Outputs show **`elastic_ip`** and an example **`ssh_command`**.

## After apply

1. SSH: `ssh -i ~/.ssh/your-key.pem ec2-user@<elastic_ip>`
2. Copy app + `.env.staging`, install Docker Compose plugin if needed, run `npm run docker:staging` (or your deploy flow).
3. Point a DNS A record at the Elastic IP when ready.

## Destroy

```bash
export AWS_PROFILE=terraform-mori
terraform destroy
```

Releasing the Elastic IP avoids ongoing charges when the instance is gone.
