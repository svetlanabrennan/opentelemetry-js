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

import { diag, TextMapPropagator } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api-metrics';
import { ContextManager } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics-base';
import {
  InstrumentationOption,
  registerInstrumentations,
} from '@opentelemetry/instrumentation';
import { NodeTracerConfig, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { awsEc2Detector } from '@opentelemetry/resource-detector-aws';
import { gcpDetector } from '@opentelemetry/resource-detector-gcp';
import {
  detectResources,
  envDetector,
  processDetector,
  Resource,
  ResourceDetectionConfig,
} from '@opentelemetry/resources';
import { BatchSpanProcessor, SpanExporter, SpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeSDKConfiguration } from './types';
import { getEnv } from '@opentelemetry/core';
import { OTLPTraceExporter as OTLPProtoTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPTraceExporter as OTLPHttpTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPGrpcTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';

/** This class represents everything needed to register a fully configured OpenTelemetry Node.js SDK */
export class NodeSDK {
  private _tracerProviderConfig?: {
    tracerConfig: NodeTracerConfig;
    spanProcessor: SpanProcessor;
    contextManager?: ContextManager;
    textMapPropagator?: TextMapPropagator;
  };
  private _instrumentations: InstrumentationOption[];
  private _metricReader?: MetricReader;

  private _resource: Resource;

  private _autoDetectResources: boolean;

  private _tracerProvider?: NodeTracerProvider;
  private _meterProvider?: MeterProvider;

  private DATA_TYPE_TRACES = 'traces';

  private _spanProcessors?: (BatchSpanProcessor | SimpleSpanProcessor)[];

  /**
   * Create a new NodeJS SDK instance
   */
  public constructor(configuration: Partial<NodeSDKConfiguration> = {}) {
    this._resource = configuration.resource ?? new Resource({});

    this._autoDetectResources = configuration.autoDetectResources ?? true;

    const tracerProviderConfig: NodeTracerConfig = {};

    // let spanProcessors: BatchSpanProcessor[];

    if (configuration.spanProcessor || configuration.traceExporter) {
      if (configuration.sampler) {
        tracerProviderConfig.sampler = configuration.sampler;
      }
      if (configuration.spanLimits) {
        tracerProviderConfig.spanLimits = configuration.spanLimits;
      }

      const spanProcessor =
        configuration.spanProcessor ??
        new BatchSpanProcessor(configuration.traceExporter!);

      this.configureTracerProvider(
        tracerProviderConfig,
        spanProcessor,
        configuration.contextManager,
        configuration.textMapPropagator
      );
    // create trace exporter(s) from env
    } else {
      let traceExportersList = this.retrieveListOfExporters('trace');

      if (traceExportersList.length > 1 && traceExportersList.includes('none')) {
        diag.warn('OTEL_TRACES_EXPORTER contains "none" along with other exporters. Using default otlp exporter.');
        traceExportersList = ['otlp'];
      } else if (traceExportersList[0] === 'none') {
        diag.warn('OTEL_TRACES_EXPORTER contains "none". SDK will not be initialized');
      } else {
        const configuredExporters: SpanExporter[] =
          traceExportersList.map(exporterName => {
            return this.configureExporter(exporterName);
          });

        this._spanProcessors = this.configureSpanProcessors(configuredExporters);
      }
    }

    if (configuration.metricReader) {
      this.configureMeterProvider(configuration.metricReader);
    }

    let instrumentations: InstrumentationOption[] = [];
    if (configuration.instrumentations) {
      instrumentations = configuration.instrumentations;
    }
    this._instrumentations = instrumentations;
  }

  public configureSpanProcessors(exporters: SpanExporter[]): (BatchSpanProcessor | SimpleSpanProcessor)[] {
    return exporters.map(exporter => {
      if (exporter instanceof ConsoleSpanExporter) {
        return new SimpleSpanProcessor(exporter);
      } else {
        return new BatchSpanProcessor(exporter);
      }
    });
  }

  private retrieveListOfExporters(type: string): string[]{
    if (type === 'trace') {
      const traceList = getEnv().OTEL_TRACES_EXPORTER.split(',');
      const uniqueTraceExporters = Array.from(
        new Set(traceList)
      );

      return this.filterBlanksAndNulls(uniqueTraceExporters);
    } else if (type === 'metric') {
      const metricList = getEnv().OTEL_METRICS_EXPORTER;

      const uniqueMetricExporters = Array.from(
        new Set(metricList)
      );

      return this.filterBlanksAndNulls(uniqueMetricExporters);
    } else {
      const traceList = getEnv().OTEL_LOGS_EXPORTER.split(',');
      const uniqueLogExporters = Array.from(
        new Set(traceList)
      );

      return this.filterBlanksAndNulls(uniqueLogExporters);
    }
  }

  private filterBlanksAndNulls(list: string[]): string[] {
    return list.map(item => item.trim())
      .filter(s => s !== 'null' && s !== '');
  }

  public configureExporter(name: string): SpanExporter {
    switch (name) {
      // case 'jaegar':
      //   return this.configureJaeger();
      // case 'zipkin':
      //   return this.configureZipkin();
      // case 'console':
      //   return this.configureConsole();
      default:
        return this.configureOtlp();
    }
  }

  public configureOtlp(): SpanExporter {
    const protocol = this.getOtlpProtocol(this.DATA_TYPE_TRACES);

    if (protocol === 'http/protobuf') {
      // TODO: add enpoint, headers
      return new OTLPProtoTraceExporter();
    } else if (protocol === 'grpc') {
      // TODO: add enpoint, headers, security
      return new OTLPGrpcTraceExporter();
    } else {
      // TODO: add enpoint, headers
      return new OTLPHttpTraceExporter();
    }
  }
  // public configureJaeger(): SpanExporter {

  // }

  // public configureZipkin(): SpanExporter {

  // }

  // public configureConsole(): SpanExporter {

  // }

  public getOtlpProtocol(dataType: string): string {
    switch (dataType) {
      case 'traces':
        return getEnv().OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
      case 'metrics':
        return getEnv().OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;
      default:
        return getEnv().OTEL_EXPORTER_OTLP_PROTOCOL;
    }
  }

  /** Set configurations required to register a NodeTracerProvider */
  public configureTracerProvider(
    tracerConfig: NodeTracerConfig,
    spanProcessor: SpanProcessor,
    contextManager?: ContextManager,
    textMapPropagator?: TextMapPropagator
  ): void {
    this._tracerProviderConfig = {
      tracerConfig,
      spanProcessor,
      contextManager,
      textMapPropagator,
    };
  }

  /** Set configurations needed to register a MeterProvider */
  public configureMeterProvider(reader: MetricReader): void {
    this._metricReader = reader;
  }

  /** Detect resource attributes */
  public async detectResources(config?: ResourceDetectionConfig): Promise<void> {
    const internalConfig: ResourceDetectionConfig = {
      detectors: [awsEc2Detector, gcpDetector, envDetector, processDetector],
      ...config,
    };

    this.addResource(await detectResources(internalConfig));
  }

  /** Manually add a resource */
  public addResource(resource: Resource): void {
    this._resource = this._resource.merge(resource);
  }

  /**
   * Once the SDK has been configured, call this method to construct SDK components and register them with the OpenTelemetry API.
   */
  public async start(): Promise<void> {
    if (this._autoDetectResources) {
      await this.detectResources();
    }

    if (this._tracerProviderConfig) {
      const tracerProvider = new NodeTracerProvider({
        ...this._tracerProviderConfig.tracerConfig,
        resource: this._resource,
      });

      this._tracerProvider = tracerProvider;

      tracerProvider.addSpanProcessor(this._tracerProviderConfig.spanProcessor);
      tracerProvider.register({
        contextManager: this._tracerProviderConfig.contextManager,
        propagator: this._tracerProviderConfig.textMapPropagator,
      });
    }

    if (this._spanProcessors) {
      const tracerProvider = new NodeTracerProvider({
        // ...this._tracerProviderConfig.tracerConfig,
        resource: this._resource,
      });

      this._spanProcessors.forEach(processor => {
        tracerProvider.addSpanProcessor(processor);
      });

      tracerProvider.register({
        // contextManager: this._tracerProviderConfig.contextManager,
        // propagator: this._tracerProviderConfig.textMapPropagator,
      });
    }

    if (this._metricReader) {
      const meterProvider = new MeterProvider({
        resource: this._resource,
      });

      meterProvider.addMetricReader(this._metricReader);

      this._meterProvider = meterProvider;

      metrics.setGlobalMeterProvider(meterProvider);
    }

    registerInstrumentations({
      instrumentations: this._instrumentations,
    });
  }

  public shutdown(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    if (this._tracerProvider) {
      promises.push(this._tracerProvider.shutdown());
    }
    if (this._meterProvider) {
      promises.push(this._meterProvider.shutdown());
    }

    return (
      Promise.all(promises)
        // return void instead of the array from Promise.all
        .then(() => {
        })
    );
  }
}
