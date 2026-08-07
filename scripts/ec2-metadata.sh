#!/usr/bin/env bash
TOKEN=$(curl -s -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')
MD() { curl -s -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
echo "instance-id: $(MD instance-id)"
echo "region: $(MD placement/region)"
echo "security-groups: $(MD security-groups)"
echo "public-ipv4: $(MD public-ipv4)"
