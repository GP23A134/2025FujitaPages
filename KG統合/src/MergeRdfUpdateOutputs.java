import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphFactory;

/** 3つの変換結果を1つのN-Quadsへ統合します。 */
public final class MergeRdfUpdateOutputs {
    private static final Path DEFAULT_TARGET_RDF = Paths.get(
            "output/classes/REV-KG-DEV_kg-data_2026-08-13_13-18-16_with-hierarchy.nq");
    private static final Path DEFAULT_STAKEHOLDER_RDF = Paths.get("input/integration/stakeholders-with-top.nq");
    private static final Path DEFAULT_DOCUMENT_TTL = Paths.get("input/integration/documents.ttl");
    private static final Path DEFAULT_OUTPUT_RDF = Paths.get(
            "output/REV-KG-DEV_kg-data_2026-08-13_13-18-16_integrated.nq");

    private MergeRdfUpdateOutputs() {}

    public static void main(String[] args) throws IOException {
        if (args.length != 0 && args.length != 4) {
            throw new IllegalArgumentException("使い方: java MergeRdfUpdateOutputs "
                    + "[対象クラスN-Quads ステークホルダーN-Quads 資料Turtle 出力N-Quads]");
        }
        Path targetRdf = args.length == 4 ? Paths.get(args[0]) : DEFAULT_TARGET_RDF;
        Path stakeholderRdf = args.length == 4 ? Paths.get(args[1]) : DEFAULT_STAKEHOLDER_RDF;
        Path documentTtl = args.length == 4 ? Paths.get(args[2]) : DEFAULT_DOCUMENT_TTL;
        Path outputRdf = args.length == 4 ? Paths.get(args[3]) : DEFAULT_OUTPUT_RDF;
        merge(targetRdf, stakeholderRdf, documentTtl, outputRdf);
        System.out.println("統合N-Quads: " + outputRdf.toAbsolutePath());
    }

    static void merge(Path targetRdf, Path stakeholderRdf, Path documentTtl, Path outputRdf)
            throws IOException {
        requireFile(targetRdf);
        requireFile(stakeholderRdf);
        requireFile(documentTtl);

        DatasetGraph merged = DatasetGraphFactory.createTxnMem();
        try {
            RDFDataMgr.read(merged, targetRdf.toUri().toString(), Lang.NQUADS);
            RDFDataMgr.read(merged, stakeholderRdf.toUri().toString(), Lang.NQUADS);
            RDFDataMgr.read(merged, documentTtl.toUri().toString(), Lang.TURTLE);
            writeAtomically(outputRdf, merged);
        } finally {
            merged.close();
        }
    }

    private static void requireFile(Path path) throws IOException {
        if (!Files.isRegularFile(path)) throw new IOException("統合元ファイルがありません: " + path);
    }

    private static void writeAtomically(Path output, DatasetGraph dataset) throws IOException {
        Path absolute = output.toAbsolutePath();
        Files.createDirectories(absolute.getParent());
        Path temporary = absolute.resolveSibling(absolute.getFileName() + ".tmp");
        try {
            try (OutputStream stream = Files.newOutputStream(temporary)) {
                RDFDataMgr.write(stream, dataset, Lang.NQUADS);
            }
            try {
                Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporary, absolute, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
