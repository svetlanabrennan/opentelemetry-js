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

import * as assert from 'assert';
import api, {
  context,
  Context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  diag,
  metrics,
  propagation,
  ROOT_CONTEXT,
  Span,
  SpanOptions,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  trace,
  TraceFlags,
} from '../../../src';
import { DiagAPI } from '../../../src/api/diag';
import { NoopMeter } from '../../../src/metrics/NoopMeter';
import { NoopMeterProvider } from '../../../src/metrics/NoopMeterProvider';
import { NonRecordingSpan } from '../../../src/trace/NonRecordingSpan';
import { NoopTracer } from '../../../src/trace/NoopTracer';
import { NoopTracerProvider } from '../../../src/trace/NoopTracerProvider';

// DiagLogger implementation
const diagLoggerFunctions = [
  'verbose',
  'debug',
  'info',
  'warn',
  'error',
] as const;

describe('API', function () {
  it('should expose a tracer provider via getTracerProvider', function () {
    const tracer = api.trace.getTracerProvider();
    assert.ok(tracer);
    assert.strictEqual(typeof tracer, 'object');
  });

  it('getActiveSpan should get the current span', function () {
    const span = new NonRecordingSpan();
    const ctx = trace.setSpan(ROOT_CONTEXT, span);
    context.setGlobalContextManager({
      active: () => ctx,
      disable: () => {},
    } as any);

    const active = trace.getActiveSpan();
    assert.strictEqual(active, span);

    context.disable();
  });

  describe('Context', function () {
    it('with should forward this, arguments and return value', function () {
      function fnWithThis(this: string, a: string, b: number): string {
        assert.strictEqual(this, 'that');
        assert.strictEqual(arguments.length, 2);
        assert.strictEqual(a, 'one');
        assert.strictEqual(b, 2);
        return 'done';
      }

      const res = context.with(ROOT_CONTEXT, fnWithThis, 'that', 'one', 2);
      assert.strictEqual(res, 'done');

      assert.strictEqual(
        context.with(ROOT_CONTEXT, () => 3.14),
        3.14
      );
    });
  });

  describe('GlobalTracerProvider', function () {
    const spanContext = {
      traceId: 'd4cda95b652f4a1592b449d5929fda1b',
      spanId: '6e0c63257de34c92',
      traceFlags: TraceFlags.NONE,
    };
    const dummySpan = new NonRecordingSpan(spanContext);

    beforeEach(() => {
      context.disable();
      trace.disable();
      propagation.disable();
    });

    it('should use the global tracer provider', function () {
      api.trace.setGlobalTracerProvider(new TestTracerProvider());
      const tracer = api.trace.getTracerProvider().getTracer('name');
      const span = tracer.startSpan('test');
      assert.deepStrictEqual(span, dummySpan);
    });

    it('should set delegate only on success', function () {
      assert.strictEqual(
        api.trace.setGlobalTracerProvider(new TestTracerProvider()),
        true
      );
      assert.strictEqual(
        api.trace.setGlobalTracerProvider(new NoopTracerProvider()),
        false
      );
      assert.ok(api.trace.getTracer('name') instanceof TestTracer);
    });

    class TestTracer extends NoopTracer {
      override startSpan(name: string, options?: SpanOptions): Span {
        return dummySpan;
      }
    }

    class TestTracerProvider extends NoopTracerProvider {
      override getTracer(_name: string, version?: string) {
        return new TestTracer();
      }
    }

    describe('should use the global propagation', function () {
      const testKey = Symbol('kTestKey');

      interface Carrier {
        context?: Context;
        setter?: TextMapSetter;
      }

      class TestTextMapPropagation implements TextMapPropagator<Carrier> {
        inject(
          context: Context,
          carrier: Carrier,
          setter: TextMapSetter
        ): void {
          carrier.context = context;
          carrier.setter = setter;
        }

        extract(
          context: Context,
          carrier: Carrier,
          getter: TextMapGetter
        ): Context {
          return context.setValue(testKey, {
            context,
            carrier,
            getter,
          });
        }

        fields(): string[] {
          return ['TestField'];
        }
      }

      it('inject', function () {
        api.propagation.setGlobalPropagator(new TestTextMapPropagation());

        const context = ROOT_CONTEXT.setValue(testKey, 15);
        const carrier: Carrier = {};
        api.propagation.inject(context, carrier);
        assert.strictEqual(carrier.context, context);
        assert.strictEqual(carrier.setter, defaultTextMapSetter);

        const setter: TextMapSetter = {
          set: () => {},
        };
        api.propagation.inject(context, carrier, setter);
        assert.strictEqual(carrier.context, context);
        assert.strictEqual(carrier.setter, setter);
      });

      it('extract', function () {
        api.propagation.setGlobalPropagator(new TestTextMapPropagation());

        const carrier: Carrier = {};
        let context = api.propagation.extract(ROOT_CONTEXT, carrier);
        let data: any = context.getValue(testKey);
        assert.ok(data != null);
        assert.strictEqual(data.context, ROOT_CONTEXT);
        assert.strictEqual(data.carrier, carrier);
        assert.strictEqual(data.getter, defaultTextMapGetter);

        const getter: TextMapGetter = {
          keys: () => [],
          get: () => undefined,
        };
        context = api.propagation.extract(ROOT_CONTEXT, carrier, getter);
        data = context.getValue(testKey);
        assert.ok(data != null);
        assert.strictEqual(data.context, ROOT_CONTEXT);
        assert.strictEqual(data.carrier, carrier);
        assert.strictEqual(data.getter, getter);
      });

      it('fields', function () {
        api.propagation.setGlobalPropagator(new TestTextMapPropagation());

        const fields = api.propagation.fields();
        assert.deepStrictEqual(fields, ['TestField']);
      });
    });
  });

  describe('Global diag', function () {
    it('initialization', function () {
      const inst = DiagAPI.instance();

      assert.deepStrictEqual(diag, inst);
    });

    diagLoggerFunctions.forEach(fName => {
      it(`no argument logger ${fName} message doesn't throw`, function () {
        //@ts-expect-error an undefined logger is not allowed
        diag.setLogger();
        assert.doesNotThrow(() => {
          diag[fName](`${fName} message`);
        });
      });

      it(`null logger ${fName} message doesn't throw`, function () {
        diag.setLogger(null as any);
        assert.doesNotThrow(() => {
          diag[fName](`${fName} message`);
        });
      });

      it(`undefined logger ${fName} message doesn't throw`, function () {
        diag.setLogger(undefined as any);
        assert.doesNotThrow(() => {
          diag[fName](`${fName} message`);
        });
      });

      it(`empty logger ${fName} message doesn't throw`, function () {
        diag.setLogger({} as any);
        assert.doesNotThrow(() => {
          diag[fName](`${fName} message`);
        });
      });
    });
  });

  describe('Global metrics', function () {
    it('should expose a meter provider via getMeterProvider', function () {
      const meter = metrics.getMeterProvider();
      assert.ok(meter);
      assert.strictEqual(typeof meter, 'object');
    });

    describe('GlobalMeterProvider', function () {
      const dummyMeter = new NoopMeter();

      beforeEach(() => {
        metrics.disable();
      });

      it('should use the global meter provider', function () {
        metrics.setGlobalMeterProvider(new TestMeterProvider());
        const meter = metrics.getMeterProvider().getMeter('name');
        assert.deepStrictEqual(meter, dummyMeter);
      });

      class TestMeterProvider extends NoopMeterProvider {
        override getMeter() {
          return dummyMeter;
        }
      }
    });
  });
});
