import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;

/** 3つのRDF処理を実行し、結果を統合するランチャーです。 */
public final class RunAllRdfUpdates {
    private static final Path BASE_RDF = Paths.get(
            "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq");
    private static final Path TARGET_CLASSES = Paths.get(
            "input/target-classes/class-update-20261117-094934-210.json");
    private static final Path STAKEHOLDERS = Paths.get(
            "input/stakeholders/class-update-20261117-104033-219.json");
    private static final Path CLASSIFIED_DOCUMENTS = Paths.get(
            "input/integration/documents-classified.tsv");
    private static final Path TARGET_OUTPUT = Paths.get(
            "output/classes/REV-KG-DEV_kg-data_2026-08-13_13-18-16_with-hierarchy.nq");
    private static final Path TARGET_UNMAPPED = Paths.get("output/classes/unmapped-classes.txt");
    private static final Path STAKEHOLDER_OUTPUT = Paths.get("input/integration/stakeholders-with-top.nq");
    private static final Path STAKEHOLDER_UNMAPPED = Paths.get("input/integration/unmapped-stakeholder-classes.txt");
    private static final Path DOCUMENT_OUTPUT = Paths.get("input/integration/documents.ttl");
    private static final Path INTEGRATED_OUTPUT = Paths.get(
            "output/REV-KG-DEV_kg-data_2026-08-13_13-18-16_integrated.nq");

    private RunAllRdfUpdates() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 0) {
            throw new IllegalArgumentException("使い方: java RunAllRdfUpdates（引数なし）");
        }
        checkRequiredFile(BASE_RDF);
        checkRequiredFile(TARGET_CLASSES);
        checkRequiredFile(STAKEHOLDERS);
        checkRequiredFile(CLASSIFIED_DOCUMENTS);

        Path outputDirectory = Paths.get("output");
        Files.createDirectories(outputDirectory);
        Path staging = Files.createTempDirectory(outputDirectory, ".rdf-update-");
        try {
            Path targetRdf = staging.resolve("target-classes.nq");
            Path stakeholderRdf = staging.resolve("stakeholders.nq");
            Path documentTtl = staging.resolve("documents.ttl");
            Path integratedRdf = staging.resolve("integrated.nq");

            System.out.println("[1/4] 対象クラスの階層付与を実行します。");
            AddMiddleAndTopClassesToRdf.main(new String[] {
                    BASE_RDF.toString(), TARGET_CLASSES.toString(), targetRdf.toString() });

            System.out.println("[2/4] ステークホルダーの上位クラス付与を実行します。");
            AddStakeholderTopClassesToRdf.main(new String[] {
                    BASE_RDF.toString(), STAKEHOLDERS.toString(), stakeholderRdf.toString() });

            System.out.println("[3/4] 分類済み資料のTurtle変換を実行します。");
            ConvertClassifiedDocumentsToTurtle.main(new String[] {
                    CLASSIFIED_DOCUMENTS.toString(), documentTtl.toString() });

            System.out.println("[4/4] 3つの処理結果をN-Quadsへ統合します。");
            MergeRdfUpdateOutputs.merge(targetRdf, stakeholderRdf, documentTtl, integratedRdf);

            publish(staging, List.of(
                    new OutputFile(targetRdf, TARGET_OUTPUT),
                    new OutputFile(staging.resolve("unmapped-classes.txt"), TARGET_UNMAPPED),
                    new OutputFile(stakeholderRdf, STAKEHOLDER_OUTPUT),
                    new OutputFile(staging.resolve("unmapped-stakeholder-classes.txt"), STAKEHOLDER_UNMAPPED),
                    new OutputFile(documentTtl, DOCUMENT_OUTPUT),
                    new OutputFile(integratedRdf, INTEGRATED_OUTPUT)));
            System.out.println("3つの処理とRDF統合が完了しました。");
            System.out.println("統合N-Quads: " + INTEGRATED_OUTPUT.toAbsolutePath());
        } finally {
            deleteTree(staging);
        }
    }

    private static void checkRequiredFile(Path path) throws IOException {
        if (!Files.isRegularFile(path)) throw new IOException("必要な入力ファイルがありません: " + path);
    }

    private static void publish(Path staging, List<OutputFile> files) throws IOException {
        Path backupDirectory = staging.resolve("backups");
        Files.createDirectories(backupDirectory);
        List<Path> changed = new ArrayList<>();
        List<Path> backedUp = new ArrayList<>();
        try {
            for (int i = 0; i < files.size(); i++) {
                Path destination = files.get(i).destination.toAbsolutePath();
                Files.createDirectories(destination.getParent());
                if (Files.exists(destination)) {
                    Path backup = backupDirectory.resolve(Integer.toString(i));
                    Files.move(destination, backup, StandardCopyOption.REPLACE_EXISTING);
                    backedUp.add(backup);
                } else {
                    backedUp.add(null);
                }
            }
            for (OutputFile file : files) {
                Path destination = file.destination.toAbsolutePath();
                Files.move(file.staged, destination, StandardCopyOption.REPLACE_EXISTING);
                changed.add(destination);
            }
        } catch (IOException failure) {
            IOException rollbackFailure = null;
            for (Path destination : changed) {
                try {
                    Files.deleteIfExists(destination);
                } catch (IOException e) {
                    if (rollbackFailure == null) rollbackFailure = e;
                    else rollbackFailure.addSuppressed(e);
                }
            }
            for (int i = 0; i < backedUp.size(); i++) {
                Path backup = backedUp.get(i);
                if (backup != null && Files.exists(backup)) {
                    try {
                        Files.move(backup, files.get(i).destination.toAbsolutePath(),
                                StandardCopyOption.REPLACE_EXISTING);
                    } catch (IOException e) {
                        if (rollbackFailure == null) rollbackFailure = e;
                        else rollbackFailure.addSuppressed(e);
                    }
                }
            }
            if (rollbackFailure != null) failure.addSuppressed(rollbackFailure);
            throw failure;
        }
    }

    private static void deleteTree(Path directory) throws IOException {
        if (!Files.exists(directory)) return;
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    private record OutputFile(Path staged, Path destination) {}
}
