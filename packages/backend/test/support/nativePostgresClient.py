"""Test-only JSON-lines bridge to native libpq, always on loopback.

No connection URL, credentials, service name or production settings accepted.
The harness creates a fresh temporary PostgreSQL cluster and passes its port.
"""
import ctypes as c
import json
import os
from pathlib import Path
import sys

bin_dir = Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
assert 1024 < port < 65536
if os.name == "nt":
    dll_directory = os.add_dll_directory(str(bin_dir))
pq = c.CDLL(str(bin_dir / "libpq.dll") if os.name == "nt" else "libpq.so")
pq.PQconnectdb.argtypes = [c.c_char_p]
pq.PQconnectdb.restype = c.c_void_p
pq.PQstatus.argtypes = [c.c_void_p]
pq.PQerrorMessage.argtypes = [c.c_void_p]
pq.PQerrorMessage.restype = c.c_char_p
pq.PQexec.argtypes = [c.c_void_p, c.c_char_p]
pq.PQexec.restype = c.c_void_p
pq.PQresultStatus.argtypes = [c.c_void_p]
pq.PQresultErrorMessage.argtypes = [c.c_void_p]
pq.PQresultErrorMessage.restype = c.c_char_p
pq.PQresultErrorField.argtypes = [c.c_void_p, c.c_int]
pq.PQresultErrorField.restype = c.c_char_p
pq.PQntuples.argtypes = [c.c_void_p]
pq.PQnfields.argtypes = [c.c_void_p]
pq.PQfname.argtypes = [c.c_void_p, c.c_int]
pq.PQfname.restype = c.c_char_p
pq.PQgetisnull.argtypes = [c.c_void_p, c.c_int, c.c_int]
pq.PQgetvalue.argtypes = [c.c_void_p, c.c_int, c.c_int]
pq.PQgetvalue.restype = c.c_char_p
pq.PQclear.argtypes = [c.c_void_p]
pq.PQfinish.argtypes = [c.c_void_p]

conn = pq.PQconnectdb(f"host=127.0.0.1 port={port} user=postgres dbname=postgres sslmode=disable connect_timeout=5 application_name=unggul-local-regression".encode())
if pq.PQstatus(conn) != 0:
    raise RuntimeError(pq.PQerrorMessage(conn).decode())
print(json.dumps({"ready": True}), flush=True)
try:
    for line in sys.stdin:
        request = json.loads(line)
        result = pq.PQexec(conn, request["sql"].encode())
        try:
            if pq.PQresultStatus(result) not in (1, 2):
                code = pq.PQresultErrorField(result, ord("C"))
                response = {"error": pq.PQresultErrorMessage(result).decode(), "code": code.decode() if code else None}
            else:
                fields = [pq.PQfname(result, col).decode() for col in range(pq.PQnfields(result))]
                rows = [{name: None if pq.PQgetisnull(result, row, col) else pq.PQgetvalue(result, row, col).decode()
                         for col, name in enumerate(fields)} for row in range(pq.PQntuples(result))]
                response = {"rows": rows}
            print(json.dumps(response), flush=True)
        finally:
            pq.PQclear(result)
finally:
    pq.PQfinish(conn)
