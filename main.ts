import jsonld from 'jsonld';
import { Store, Parser, Writer } from 'n3';
import * as fs from 'fs/promises';
import * as path from 'path';

// Define types
interface JsonLdDocument {
    [key: string]: any;
}

interface FrameInput {
    [key: string]: any;
}

class AdvancedTtlProcessor {
    private store: Store;
    private context: JsonLdDocument;

    constructor(context?: JsonLdDocument) {
        this.store = new Store();
        this.context = context || {
            "@context": {
                "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
                "xsd": "http://www.w3.org/2001/XMLSchema#",
                "dc": "http://purl.org/dc/elements/1.1/",
                "foaf": "http://xmlns.com/foaf/0.1/",
                "schema": "http://schema.org/",
                "ex": "http://example.org/"
            }
        };
    }

    /**
     * Read and parse TTL file using N3.js
     */
    async parseTtlFile(filePath: string): Promise<Store> {
        try {
            const ttlContent = await fs.readFile(filePath, 'utf-8');
            return await this.parseTtlContent(ttlContent);
        } catch (error) {
            throw new Error(`Error reading or parsing TTL file: ${error}`);
        }
    }

    /**
     * Parse TTL content using N3.js parser
     */
    async parseTtlContent(ttlContent: string): Promise<Store> {
        return new Promise((resolve, reject) => {
            const parser = new Parser();
            const store = new Store();

            parser.parse(ttlContent, (error, quad, prefixes) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (quad) {
                    store.addQuad(quad);
                } else {
                    // Parsing complete
                    this.store = store;
                    resolve(store);
                }
            });
        });
    }

    /**
     * Convert N3.js store to JSON-LD using different strategies
     */
    async convertToJsonLd(store?: Store, strategy: 'basic' | 'grouped' | 'flat' = 'grouped'): Promise<JsonLdDocument> {
        const targetStore = store || this.store;

        switch (strategy) {
            case 'basic':
                return await this.convertToJsonLdBasic(targetStore);
            case 'grouped':
                return await this.convertToJsonLdGrouped(targetStore);
            case 'flat':
                return await this.convertToJsonLdFlat(targetStore);
            default:
                return await this.convertToJsonLdGrouped(targetStore);
        }
    }

    /**
     * Basic conversion - simple quad to JSON-LD
     */
    private async convertToJsonLdBasic(store: Store): Promise<JsonLdDocument> {
        const quads = store.getQuads(null, null, null, null);

        const graph = quads.map(quad => {
            const subject = quad.subject.value;
            const predicate = quad.predicate.value;
            const object = this.quadObjectToJsonLd(quad.object);

            return {
                "@id": subject,
                [predicate]: object
            };
        });

        return {
            ...this.context,
            "@graph": graph
        };
    }

    /**
     * Grouped conversion - group properties by subject
     */
    private async convertToJsonLdGrouped(store: Store): Promise<JsonLdDocument> {
        const quads = store.getQuads(null, null, null, null);
        const subjects = new Map();

        // Group quads by subject
        for (const quad of quads) {
            const subjectId = quad.subject.value;

            if (!subjects.has(subjectId)) {
                subjects.set(subjectId, {
                    "@id": subjectId
                });
            }

            const subject = subjects.get(subjectId);
            const predicate = quad.predicate.value;
            const object = this.quadObjectToJsonLd(quad.object);

            // Handle multiple values for same predicate
            if (subject[predicate]) {
                if (Array.isArray(subject[predicate])) {
                    subject[predicate].push(object);
                } else {
                    subject[predicate] = [subject[predicate], object];
                }
            } else {
                subject[predicate] = object;
            }
        }

        return {
            ...this.context,
            "@graph": Array.from(subjects.values())
        };
    }

    /**
     * Flat conversion - for simpler structures
     */
    private async convertToJsonLdFlat(store: Store): Promise<JsonLdDocument> {
        const quads = store.getQuads(null, null, null, null);
        const document: JsonLdDocument = { ...this.context };

        for (const quad of quads) {
            const subject = quad.subject.value;
            const predicate = quad.predicate.value;
            const object = this.quadObjectToJsonLd(quad.object);

            if (!document[subject]) {
                document[subject] = { "@id": subject };
            }

            if (document[subject][predicate]) {
                if (Array.isArray(document[subject][predicate])) {
                    document[subject][predicate].push(object);
                } else {
                    document[subject][predicate] = [document[subject][predicate], object];
                }
            } else {
                document[subject][predicate] = object;
            }
        }

        return document;
    }

    /**
     * Convert N3.js Quad object to JSON-LD compatible object
     */
    private quadObjectToJsonLd(object: any): any {
        if (object.termType === 'Literal') {
            const result: any = {
                "@value": object.value
            };

            if (object.datatype && object.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
                result["@type"] = object.datatype.value;
            }

            if (object.language) {
                result["@language"] = object.language;
            }

            return result;
        } else if (object.termType === 'NamedNode') {
            return { "@id": object.value };
        } else if (object.termType === 'BlankNode') {
            return { "@id": `_:${object.value}` };
        }

        return object.value;
    }

    /**
     * Apply context to JSON-LD document
     */
    async applyContext(document: JsonLdDocument, customContext?: JsonLdDocument): Promise<JsonLdDocument> {
        try {
            const contextToUse = customContext || this.context;
            const compacted = await jsonld.compact(document, contextToUse);
            return compacted;
        } catch (error) {
            throw new Error(`Error applying context: ${error}`);
        }
    }

    /**
     * Frame JSON-LD document
     */
    async frameDocument(document: JsonLdDocument, frame: FrameInput): Promise<JsonLdDocument> {
        try {
            const framed = await jsonld.frame(document, frame);
            return framed;
        } catch (error) {
            throw new Error(`Error framing document: ${error}`);
        }
    }

    /**
     * Get statistics about the parsed TTL
     */
    getStoreStats(): { quadCount: number; subjects: number; predicates: number; objects: number } {
        const quads = this.store.getQuads(null, null, null, null);
        const subjects = new Set(quads.map(q => q.subject.value));
        const predicates = new Set(quads.map(q => q.predicate.value));
        const objects = new Set(quads.map(q => q.object.value));

        return {
            quadCount: quads.length,
            subjects: subjects.size,
            predicates: predicates.size,
            objects: objects.size
        };
    }

    /**
     * Complete processing pipeline
     */
    async processTtlFile(
        ttlFilePath: string,
        frame?: FrameInput,
        customContext?: JsonLdDocument,
        conversionStrategy: 'basic' | 'grouped' | 'flat' = 'grouped'
    ): Promise<{
        store: Store;
        original: JsonLdDocument;
        compacted: JsonLdDocument;
        framed?: JsonLdDocument;
        stats: { quadCount: number; subjects: number; predicates: number; objects: number };
    }> {
        try {
            // Parse TTL file
            const store = await this.parseTtlFile(ttlFilePath);
            console.log('TTL file parsed successfully');

            // Get statistics
            const stats = this.getStoreStats();
            console.log(`Store stats: ${stats.quadCount} quads, ${stats.subjects} subjects, ${stats.predicates} predicates, ${stats.objects} objects`);

            // Convert to JSON-LD
            const jsonLdDoc = await this.convertToJsonLd(store, conversionStrategy);
            console.log('Converted to JSON-LD');

            // Apply context
            const compactedDoc = await this.applyContext(jsonLdDoc, customContext);
            console.log('Context applied');

            // Frame if frame is provided
            let framedDoc: JsonLdDocument | undefined;
            if (frame) {
                framedDoc = await this.frameDocument(jsonLdDoc, frame);
                console.log('Document framed');
            }

            return {
                store,
                original: jsonLdDoc,
                compacted: compactedDoc,
                framed: framedDoc,
                stats
            };
        } catch (error) {
            throw new Error(`Error processing TTL file: ${error}`);
        }
    }
}

async function saveJsonToFile(filePath: string, data: JsonLdDocument): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`JSON-LD saved to ${filePath}`);
    } catch (error) {
        throw new Error(`Error saving JSON to file: ${error}`);
    }
}

async function main() {
    const processor = new AdvancedTtlProcessor();

    // Define a custom frame for Person entities
    // Load frame from remote URL
    const frameUrl = 'https://raw.githubusercontent.com/globalise-huygens/gl-etl/refs/heads/main/entities/locations/frame.json';
    const frame: FrameInput = JSON.parse(await (await fetch(frameUrl)).text());

    // Custom context (optional)
    const contextUrl = 'https://raw.githubusercontent.com/globalise-huygens/gl-etl/refs/heads/main/entities/locations/context.json';
    const customContext: JsonLdDocument = JSON.parse(await (await fetch(contextUrl)).text());

    try {
        // Process the TTL file
        const result = await processor.processTtlFile(
            './run.ttl', // Your TTL file path
            frame,
            customContext,
            'basic'
        );

        console.log('\n=== Store Statistics ===');
        console.log(result.stats);

        console.log('\n=== Original JSON-LD ===');
        console.log('\n=== Saved to  original.json ===');
        await saveJsonToFile('./original.json', result.original);

        console.log('\n=== With Compacted Applied ===');
        console.log('\n=== Saved to compacted.json ===');
        await saveJsonToFile('./compacted.json', result.compacted);

        console.log('\n=== With Context Applied ===');
        const contextApplied = await processor.applyContext(result.original, customContext);
        console.log('\n=== Saved to contexted.json ===');
        await saveJsonToFile('./contexted.json', contextApplied);

        if (result.framed) {
            console.log('\n=== Framed Document (Places only) ===');
            console.log('\n=== Saved to framed.json ===');
            await saveJsonToFile('./framed.json', result.framed);
            console.log('\n=== Framed & Contexted Document ===');
            // Apply context to the framed document before output
            const framedAndContexted = await processor.applyContext(result.framed, customContext);
            const outputPath = './result.json';
            await saveJsonToFile(outputPath, framedAndContexted);
            console.log(`Result written to ${outputPath}`);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run examples
if (require.main === module) {
    main().catch(console.error);
}

export { AdvancedTtlProcessor };


