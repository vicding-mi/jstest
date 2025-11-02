import jsonld from 'jsonld';
import {Parser, Writer} from 'n3';
import * as fs from 'fs/promises';
import * as path from 'path';

// Define types
interface JsonLdDocument {
    [key: string]: any;
}

interface FrameInput {
    [key: string]: any;
}

async function convertToJsonLd(
    ttlFilePath: string,
    contextJson: JsonLdDocument,
    frameJson: FrameInput,
    compacted: boolean = true
): Promise<JsonLdDocument> {
    try {
        const ttlString = await fs.readFile(ttlFilePath, 'utf-8');
        const nquads = await turtleToNQuads(ttlString);
        const doc = await jsonld.fromRDF(nquads, { format: 'application/n-quads' });

        let result = doc;

        // compact if needed
        if (compacted) {
            result = await jsonld.compact(doc, contextJson);
        }

        // frame the document
        result = await jsonld.frame(result, frameJson);

        return result;
    } catch (error) {
        console.error('Conversion error:', error);
        throw error;
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

async function turtleToNQuads(turtle: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parser = new Parser({ format: 'text/turtle' });
        const writer = new Writer({ format: 'N-Quads' });
        const quads = parser.parse(turtle);
        writer.addQuads(quads);
        writer.end((error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

async function main() {
    // Define a custom frame for Person entities
    // Load frame from remote URL
    const frameUrl = 'https://raw.githubusercontent.com/globalise-huygens/gl-etl/refs/heads/main/entities/locations/frame.json';
    const frame: FrameInput = JSON.parse(await (await fetch(frameUrl)).text());

    // Custom context (optional)
    const contextUrl = 'https://raw.githubusercontent.com/globalise-huygens/gl-etl/refs/heads/main/entities/locations/context.json';
    const customContext: JsonLdDocument = JSON.parse(await (await fetch(contextUrl)).text());

    try {
        // Process the TTL file
        const result = await convertToJsonLd(
            './run.ttl', // Your TTL file path
            customContext,
            frame,
            true // compacted
        );

        const outputPath = './output/result.json';
        await saveJsonToFile(outputPath, result);
        console.log(`Result written to ${outputPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run examples
if (require.main === module) {
    main().catch(console.error);
}

export { convertToJsonLd };
