from datetime import timedelta
from .db import Product, SellerPolicy, now, write


def seed(engine):
    with write(engine) as db:
        for pid, seller, name, ram, ssd, ask, floor, stock, days in [
            ("laptop-a", "seller-a", "Demo Ultrabook 16", 16, 512, 970000, 910000, 5, 2),
            ("laptop-b", "seller-b", "Demo Workstation 32", 32, 1024, 1240000, 1150000, 3, 3),
            ("laptop-c", "seller-c", "Demo Compact 8", 8, 256, 740000, 690000, 4, 2),
            ("laptop-d", "seller-a", "Demo Unavailable 16", 16, 512, 950000, 910000, 0, 10),
        ]:
            if db.get(Product, pid): continue
            data = {"product_id": pid, "seller_id": seller, "product_version": 1, "seller_version": 1,
                    "name": name, "ram_gb": ram, "ssd_gb": ssd, "asking_price_krw": ask,
                    "shipping_fee_krw": 10000, "fee_krw": 5000, "delivery_date": (now() + timedelta(days=days)).date().isoformat(),
                    "expires_at": (now() + timedelta(days=30)).isoformat().replace("+00:00", "Z"), "source": "simulated"}
            db.add(Product(id=pid, data=data, stock=stock))
            db.flush()
            db.add(SellerPolicy(product_id=pid, seller_id=seller, version=1, floor=floor))
