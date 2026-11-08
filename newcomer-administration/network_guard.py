"""Default deny. Rules must be observed, exact endpoint/action matches."""
def classify_request(request,mode,rules):
    if mode!='LIVE_READONLY' or request.get('has_unknown_action'): return 'BLOCK'
    keys=('origin','path','method','event_target','submit_control','query_action')
    for rule in rules:
        if all(request.get(k)==rule.get(k) for k in keys): return 'ALLOW_READ'
    return 'BLOCK'
