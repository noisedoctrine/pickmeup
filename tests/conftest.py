from __future__ import annotations

from pathlib import Path
import zipfile

import pytest


@pytest.fixture
def sample_gtfs_zip(tmp_path: Path) -> Path:
    tables = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nrapidrail,Rapid Rail,https://example.test,Asia/Kuala_Lumpur\n",
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon,parent_station,category\n"
            "001,Alpha,3.10,101.60,,LRT\n"
            "002,Beta,3.11,101.61,,LRT\n"
            "003,Gamma,3.12,101.62,,MRT\n"
        ),
        "routes.txt": (
            "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n"
            "R1,rapidrail,R1,Red Line,1,cc0000\n"
            "R2,rapidrail,R2,Blue Line,1,0000cc\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n"
            "R1,weekday,T1,Gamma,0,S1\n"
            "R2,weekday,T2,Alpha,1,S2\n"
        ),
        "stop_times.txt": (
            "route_id,direction_id,trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "LEGACY1,0,T1,23:55:00,23:55:30,001,1\n"
            "LEGACY1,0,T1,24:05:00,24:05:30,002,2\n"
            "LEGACY1,0,T1,24:15:00,24:15:30,003,3\n"
            "LEGACY2,1,T2,06:00:00,06:00:30,003,1\n"
            "LEGACY2,1,T2,06:10:00,06:10:30,001,2\n"
        ),
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "weekday,1,1,1,1,1,0,0,20260101,20261231\n"
        ),
        "frequencies.txt": (
            "trip_id,start_time,end_time,headway_secs\n"
            "T1,23:30:00,24:30:00,600\n"
            "T2,06:00:00,23:00:00,600\n"
        ),
        "shapes.txt": (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
            "S1,3.10,101.60,1\n"
            "S1,3.11,101.61,2\n"
            "S1,3.12,101.62,3\n"
            "S2,3.12,101.62,1\n"
            "S2,3.10,101.60,2\n"
        ),
        "custom.txt": "thing_id,value\n01,hello\n",
    }
    path = tmp_path / "sample.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for filename, content in tables.items():
            archive.writestr(filename, content)
        archive.writestr("__MACOSX/._agency.txt", b"\x00\x05\x16\x07\xa3binary metadata")
    return path
