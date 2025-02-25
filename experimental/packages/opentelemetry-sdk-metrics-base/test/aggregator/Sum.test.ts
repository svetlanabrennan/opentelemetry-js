/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { HrTime } from '@opentelemetry/api';
import * as assert from 'assert';
import { SumAccumulation, SumAggregator } from '../../src/aggregator';
import { MetricData, PointDataType } from '../../src/export/MetricData';
import { commonValues, defaultInstrumentDescriptor } from '../util';

describe('SumAggregator', () => {
  describe('createAccumulation', () => {
    it('no exceptions on createAccumulation', () => {
      const aggregator = new SumAggregator();
      const accumulation = aggregator.createAccumulation();
      assert(accumulation instanceof SumAccumulation);
    });
  });

  describe('merge', () => {
    it('no exceptions', () => {
      const aggregator = new SumAggregator();
      const prev = aggregator.createAccumulation();
      prev.record(1);
      prev.record(2);

      const delta = aggregator.createAccumulation();
      delta.record(3);
      delta.record(4);

      const expected = aggregator.createAccumulation();
      expected.record(1 + 2 + 3 + 4);
      assert.deepStrictEqual(aggregator.merge(prev, delta), expected);
    });
  });

  describe('diff', () => {
    it('no exceptions', () => {
      const aggregator = new SumAggregator();
      const prev = aggregator.createAccumulation();
      prev.record(1);
      prev.record(2);

      const curr = aggregator.createAccumulation();
      // replay actions performed on prev
      curr.record(1);
      curr.record(2);
      // perform new actions
      curr.record(3);
      curr.record(4);

      const expected = aggregator.createAccumulation();
      expected.record(3 + 4);
      assert.deepStrictEqual(aggregator.diff(prev, curr), expected);
    });
  });

  describe('toMetricData', () => {
    it('transform without exception', () => {
      const aggregator = new SumAggregator();
      const accumulation = aggregator.createAccumulation();
      accumulation.record(1);
      accumulation.record(2);

      const startTime: HrTime = [0, 0];
      const endTime: HrTime = [1, 1];

      const expected: MetricData = {
        instrumentDescriptor: defaultInstrumentDescriptor,
        pointDataType: PointDataType.SINGULAR,
        pointData: [
          {
            attributes: {},
            startTime,
            endTime,
            point: 3,
          },
        ],
      };
      assert.deepStrictEqual(aggregator.toMetricData(
        defaultInstrumentDescriptor,
        [[{}, accumulation]],
        startTime,
        endTime,
      ), expected);
    });
  });
});

describe('SumAccumulation', () => {
  describe('record', () => {
    it('no exceptions on record', () => {
      const accumulation = new SumAccumulation();

      for (const value of commonValues) {
        accumulation.record(value);
      }
    });
  });
});
