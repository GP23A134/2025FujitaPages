import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Set;
import java.util.TreeSet;

import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphFactory;

/** ベースRDFに両クラス更新と資料データを重ね、1つのN-Quadsを生成します。 */
public final class MergeRdfUpdateOutputs {
    private static final Path DEFAULT_BASE_RDF = Paths.get(
            "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq");
    private static final Path DEFAULT_TARGET_JSON = Paths.get(
            "input/target-classes/class-update-20261117-094934-210.json");
    private static final Path DEFAULT_STAKEHOLDER_JSON = Paths.get(
            "input/stakeholders/class-update-20261117-104033-219.json");
    private static final Path DEFAULT_DOCUMENT_TTL = Paths.get("input/integration/documents.ttl");
    private static final Path DEFAULT_OUTPUT_RDF = Paths.get(
            "output/REV-KG-DEV_kg-data_2026-11-17_12-55-01_integrated.nq");

    private MergeRdfUpdateOutputs() {}

    public static void main(String[] args) throws IOException {
        if (args.length != 0 && args.length != 5) {
            throw new IllegalArgumentException("使い方: java MergeRdfUpdateOutputs "
                    + "[ベースN-Quads 対象クラスJSON ステークホルダーJSON 資料Turtle 出力N-Quads]");
        }
        Path baseRdf = args.length == 5 ? Paths.get(args[0]) : DEFAULT_BASE_RDF;
        Path targetJson = args.length == 5 ? Paths.get(args[1]) : DEFAULT_TARGET_JSON;
        Path stakeholderJson = args.length == 5 ? Paths.get(args[2]) : DEFAULT_STAKEHOLDER_JSON;
        Path documentTtl = args.length == 5 ? Paths.get(args[3]) : DEFAULT_DOCUMENT_TTL;
        Path outputRdf = args.length == 5 ? Paths.get(args[4]) : DEFAULT_OUTPUT_RDF;
        merge(baseRdf, targetJson, stakeholderJson, documentTtl, outputRdf);
        System.out.println("統合N-Quads: " + outputRdf.toAbsolutePath());
    }

    static void merge(Path baseRdf, Path targetJson, Path stakeholderJson, Path documentTtl, Path outputRdf)
            throws IOException {
        requireFile(baseRdf);
        requireFile(targetJson);
        requireFile(stakeholderJson);
        requireFile(documentTtl);

        DatasetGraph merged = DatasetGraphFactory.createTxnMem();
        try {
            RDFDataMgr.read(merged, baseRdf.toUri().toString(), Lang.NQUADS);
            Set<String> unmappedTarget = new TreeSet<>();
            Set<String> unmappedStakeholders = new TreeSet<>();
            AddMiddleAndTopClassesToRdf.applyToDataset(merged, targetJson, unmappedTarget);
            AddStakeholderTopClassesToRdf.applyToDataset(merged, stakeholderJson, unmappedStakeholders);
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
