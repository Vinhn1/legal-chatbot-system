import re

path = "docker-compose.yml"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

new_content = content.replace('"8080:80"', '"80:80"')

with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(new_content)

print("Updated docker-compose.yml ports to 80:80")

