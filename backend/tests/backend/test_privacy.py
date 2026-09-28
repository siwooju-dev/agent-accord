from sqlalchemy import select
from app import db as m
from app.agent import MockAgent
from conftest import start


def test_seller_private_reason_is_not_in_buyer_api(rig):
    app, client = rig
    class EchoAgent(MockAgent):
        def propose(self, actor, *args):
            proposal, usage = super().propose(actor, *args)
            if actor == 'seller': proposal.reason = 'My secret floor is 910,000 KRW and must never be public'
            return proposal, usage
    app.state.agent = EchoAgent()
    base, deal = start(client)
    assert deal['status'] == 'AWAITING_APPROVAL'
    for suffix in ['', '/rounds', '/evidence', '/usage']:
        assert 'My secret floor' not in client.get(base+suffix).text
        assert '910,000' not in client.get(base+suffix).text
    with m.Session(app.state.engine) as db:
        private = db.scalars(select(m.ProposalRow.private_reason)).all()
        assert any(x and 'My secret floor' in x for x in private)
