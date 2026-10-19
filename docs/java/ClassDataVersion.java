import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** 差分入力が現在のクラスデータを元に作られたか確認するための版情報です。 */
final class ClassDataVersion {
    private static final Path CLASS_DATA = Paths.get("data/integrated/class-data.json");
    private static final Path VERSION_FILE = Paths.get("data/input/current-class-data-version.txt");

    private ClassDataVersion() {}

    static String currentHash() throws IOException {
        try {
            byte[] contents = Files.readAllBytes(CLASS_DATA);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(contents));
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256を利用できません。", exception);
        }
    }

    static void writeCurrentHash() throws IOException {
        Files.createDirectories(VERSION_FILE.getParent());
        Path temporary = VERSION_FILE.resolveSibling(VERSION_FILE.getFileName() + ".tmp");
        Files.writeString(temporary, currentHash() + System.lineSeparator(), StandardCharsets.UTF_8);
        try {
            Files.move(temporary, VERSION_FILE, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException exception) {
            Files.move(temporary, VERSION_FILE, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
