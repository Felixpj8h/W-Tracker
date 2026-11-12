"""Exercise the real Nginx/Uvicorn boundary using disposable Docker resources.

Build the two images first, then run with --web-image and --backend-image.
Only synthetic identities and an isolated, internal Docker network are used.
"""
import argparse
import ipaddress
import json
import subprocess
import time
import uuid


def docker(*arguments, source=None, check=True):
    result = subprocess.run(["docker", *arguments], input=source, text=True,
                            capture_output=True, timeout=180)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or "Docker command failed")
    return result.stdout.strip()


def wait_until_ready(container, command):
    for _ in range(45):
        result = subprocess.run(["docker", "exec", container, *command],
                                capture_output=True, timeout=10)
        if result.returncode == 0:
            return
        time.sleep(1)
    detail = result.stderr.decode(errors="replace").strip()
    raise RuntimeError(f"Container health check failed for {container}: {detail}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-image", default="jern-security-web")
    parser.add_argument("--backend-image", default="jern-security-backend")
    args = parser.parse_args()
    suffix = uuid.uuid4().hex[:10]
    network = f"jern-security-{suffix}"
    backend = network + "-backend"
    web = network + "-web"
    clients = []
    network_created = False
    try:
        docker("network", "create", "--internal", network)
        network_created = True
        subnet = json.loads(docker("network", "inspect", network))[0]["IPAM"]["Config"][0]["Subnet"]
        address = ipaddress.ip_network(subnet)
        web_ip, backend_ip, ingress_ip, visitor_ip = (str(address[index]) for index in (10, 11, 12, 13))
        docker("run", "-d", "--name", backend, "--network", network, "--ip", backend_ip,
               "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/app/logs:uid=10001,gid=10001,mode=0700",
               "-e", "PYTHON_DOTENV_DISABLED=1", "-e", "APP_ENV=production",
               "-e", "DATABASE_URL=sqlite:////tmp/security.db",
               "-e", "PUBLIC_ORIGIN=https://tracker.test", "-e", "ALLOWED_ORIGINS=https://tracker.test",
               "-e", "ALLOWED_EMAILS=test@example.test,demo@example.test",
               "-e", "GOOGLE_CLIENT_ID=synthetic-client", "-e", "DEMO_ENABLED=true",
               "-e", "DEMO_OWNER_EMAIL=demo@example.test", "-e", "ENABLE_API_DOCS=false",
               "-e", f"TRUSTED_PROXY_IPS={web_ip}", args.backend_image)
        wait_until_ready(backend, ["python", "-c",
            "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=2)"])
        docker("run", "-d", "--name", web, "--network", network, "--ip", web_ip,
               "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/var/cache/nginx",
               "-e", f"BACKEND_ADDRESS={backend}:8000", "-e", f"TRUSTED_EDGE_CIDR={ingress_ip}/32",
               "-e", "TRUSTED_EDGE_HEADER=X-Real-IP", args.web_image)
        wait_until_ready(web, ["wget", "-qO-", "http://127.0.0.1:8080/healthz"])
        token = docker("exec", backend, "python", "-c",
            "from app.main import _session_value; print(_session_value({'email':'test@example.test','name':'Synthetic'}))")

        def run_client(ip, code):
            name = network + f"-client-{len(clients)}"
            clients.append(name)
            return docker("run", "--rm", "-i", "--name", name, "--network", network,
                "--ip", ip, "--read-only", "--entrypoint", "python", args.backend_image,
                "-c", "import sys; exec(sys.stdin.read())", source=code)

        common = f'''
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
base = {f'http://{web}:8080'!r}
def request(path, headers=None, method='GET'):
    try:
        with urlopen(Request(base + path, headers=headers or {{}}, method=method), timeout=5) as response:
            return response.status, response.headers, response.read()
    except HTTPError as response:
        return response.code, response.headers, response.read()
'''
        run_client(ingress_ip, common + f'''
headers = {{'Cookie': 'w_tracker_session=' + {token!r}, 'Origin': 'https://tracker.test',
           'X-Real-IP': '198.51.100.50', 'X-Forwarded-Proto': 'https'}}
assert request('/api/v1/session', headers)[0] == 200
assert request('/api/v1/session/logout', headers, 'POST')[0] == 200
assert request('/api/v1/session', headers)[0] == 401
''')
        print("PASS revocation through Nginx and Uvicorn")
        run_client(ingress_ip, common + '''
headers = {'X-Real-IP': '198.51.100.20', 'X-Forwarded-For': '203.0.113.1', 'X-Forwarded-Proto': 'https'}
for index in range(120):
    status, result_headers, _ = request('/api/v1/demo/folders', headers)
    assert status == 200, (index, status)
    assert result_headers.get('Cache-Control') == 'no-store'
    time.sleep(0.1)
assert request('/api/v1/demo/folders', headers)[0] == 429
headers['X-Forwarded-For'] = '203.0.113.45, 198.51.100.20'
assert request('/api/v1/demo/folders', headers)[0] == 429
headers['X-Real-IP'] = '198.51.100.21'
assert request('/api/v1/demo/folders', headers)[0] == 200
''')
        print("PASS trusted ingress separates clients and strips spoofed forwarding")
        run_client(visitor_ip, common + '''
headers = {'X-Real-IP': '198.51.100.60', 'X-Forwarded-For': '203.0.113.60'}
for index in range(120):
    assert request('/api/v1/demo/folders', headers)[0] == 200
    time.sleep(0.1)
assert request('/api/v1/demo/folders', headers)[0] == 429
headers = {'X-Real-IP': '198.51.100.61', 'X-Forwarded-For': '203.0.113.61'}
assert request('/api/v1/demo/folders', headers)[0] == 429
''')
        print("PASS untrusted peers cannot rotate their rate-limit identity")
    finally:
        if network_created:
            for container in [*clients, web, backend]:
                docker("rm", "-f", container, check=False)
            docker("network", "rm", network, check=False)


if __name__ == "__main__":
    main()
