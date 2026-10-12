import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;

/** dataのクラス一覧を基準に、連番IDを一覧とフォルダ名へ付与します。 */
public final class ClassIdAssigner {
    private static final String BASE_URI = "<https://kozaki-lab.jp/REFV-KG/class/";
    private static final String TOP_FOLDER_PREFIX = "t_";
    private static final String MIDDLE_FOLDER_PREFIX = "m_";
    private static final String TOP_ID_PREFIX = "t_";
    private static final String MIDDLE_ID_PREFIX = "m_";
    /** IDの数字部分の桁数です。例: 5なら00000、6なら000000から開始します。 */
    private static final int ID_DIGITS = 5;

    private ClassIdAssigner() {
        // インスタンス化しないユーティリティクラスです。
    }

    public static void main(String[] args) throws IOException {
        Path base = Path.of(".").toAbsolutePath().normalize();
        Path topFile = base.resolve("data/上位クラス一覧.tsv");
        Path middleFile = base.resolve("data/中間クラス一覧.tsv");
        Path classes = base.resolve("data/classes");
        Path backup = base.resolve("output/class-folder-backup");
        Files.createDirectories(backup);

        // ID生成前の一覧ファイルを保存し、処理途中でも元に戻せるようにします。
        backupFile(topFile, backup);
        backupFile(middleFile, backup);

        List<String> topLabels = readLabels(topFile);
        List<String> middleLabels = readLabels(middleFile);
        addMissingLabels(classes, topLabels, TOP_FOLDER_PREFIX, TOP_ID_PREFIX);
        addMissingLabels(classes, middleLabels, MIDDLE_FOLDER_PREFIX, MIDDLE_ID_PREFIX);
        writeList(topFile, "上位クラスID\t上位クラスラベル", topLabels, TOP_ID_PREFIX);
        writeList(middleFile, "中間クラスID\t中間クラスラベル", middleLabels, MIDDLE_ID_PREFIX);

        // 一覧の並び順に対応するIDを、フォルダー名にも反映します。
        renameFolders(classes, TOP_FOLDER_PREFIX, topLabels, TOP_ID_PREFIX);
        renameFolders(classes, MIDDLE_FOLDER_PREFIX, middleLabels, MIDDLE_ID_PREFIX);
        System.out.println("フォルダ名へのID付与が完了しました。バックアップ: " + backup);
    }

    /** TSVのヘッダーを除き、各行の最後の列をラベルとして読み込みます。 */
    private static List<String> readLabels(Path file) throws IOException {
        List<String> labels = new ArrayList<>();
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);

        for (int lineNumber = 1; lineNumber < lines.size(); lineNumber++) {
            String line = lines.get(lineNumber);
            if (line.isBlank()) {
                continue;
            }
            String[] columns = line.split("\\t", -1);
            labels.add(columns[columns.length - 1].trim());
        }
        return labels;
    }

    /** ラベル一覧を、連番のURI形式ID付きTSVとして保存します。 */
    private static void writeList(Path file, String header, List<String> labels, String prefix)
            throws IOException {
        List<String> lines = new ArrayList<>();
        lines.add(header);

        for (int index = 0; index < labels.size(); index++) {
            String label = labels.get(index);
            String id = createId(prefix, index);
            lines.add(id + "\t" + label);
        }
        Files.write(file, lines, StandardCharsets.UTF_8);
    }

    /** 一覧ファイルをバックアップフォルダーへコピーします。 */
    private static void backupFile(Path file, Path backupDirectory) throws IOException {
        Files.copy(file, backupDirectory.resolve(file.getFileName()),
                StandardCopyOption.REPLACE_EXISTING);
    }

    /** 一覧の位置から0始まりの連番IDを作成します。 */
    private static String createId(String prefix, int index) {
        return BASE_URI + prefix + String.format("%0" + ID_DIGITS + "d", index) + ">";
    }

    /** URIからWindowsのフォルダー名に使用できるID部分だけを取り出します。 */
    private static String idPart(String uri) {
        int lastSlash = uri.lastIndexOf('/');
        return uri.substring(lastSlash + 1, uri.length() - 1);
    }

    private static void renameFolders(Path root, String folderPrefix, List<String> labels, String idPrefix) throws IOException {
        if (!Files.isDirectory(root)) throw new IOException("フォルダが見つかりません: " + root);
        try (var stream = Files.walk(root)) {
            List<Path> folders = stream.filter(Files::isDirectory).toList();
            for (Path folder : folders) {
                String name = folder.getFileName().toString();
                String label = folderLabel(name, folderPrefix, idPrefix);
                if (label == null) continue;
                int index = labels.indexOf(label);
                if (index < 0) continue;
                String id = idPart(createId(idPrefix, index));
                Path target = folder.resolveSibling(id + "_" + label);
                if (Files.exists(target)) {
                    throw new IOException("変更先フォルダが既に存在します: " + target);
                }
                Files.move(folder, target);
            }
        }
    }

    private static void addMissingLabels(Path root, List<String> labels, String folderPrefix, String idPrefix)
            throws IOException {
        try (var stream = Files.walk(root)) {
            for (Path folder : stream.filter(Files::isDirectory).toList()) {
                String label = folderLabel(folder.getFileName().toString(), folderPrefix, idPrefix);
                if (label != null && !labels.contains(label)) labels.add(label);
            }
        }
    }

    private static String folderLabel(String name, String oldPrefix, String idPrefix) {
        String currentPrefix = idPrefix;
        if (name.startsWith(currentPrefix)) {
            String rest = name.substring(currentPrefix.length());
            if (rest.startsWith("_")) rest = rest.substring(1);
            while (rest.matches("\\d+_.*")) rest = rest.substring(rest.indexOf('_') + 1);
            if (!rest.matches("\\d+")) return rest;
        }
        return name.startsWith(oldPrefix) ? name.substring(oldPrefix.length()) : null;
    }
}


