#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
/usr/local/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from main import StockPredictionEngine
engine = StockPredictionEngine('002617', '露笑科技')
engine.fetch_data(days=500)
engine.build_features()
if engine.trainer.models:
    engine.run_evolution()
"
