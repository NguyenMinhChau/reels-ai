/* ==========================================================================
   Expanded Curated Reels Script Pool (30 Diverse Daily Life Scripts)
   - Rotates unseen scripts to the top on every visit so F5 always surfaces fresh topics
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});

    App.DEFAULT_SCRIPTS = [
        {
            id: 'tpl-1',
            category: 'lifehack',
            title: 'Mẹo giữ hành lá tươi cả tháng không úng',
            duration: '25s',
            viralScore: '98%',
            hook: 'Đừng vứt hành lá thẳng vào tủ lạnh nữa nếu không muốn ngày nào cũng phải đi chợ!',
            body: '• Bỏ hành vào ngăn mát thông thường chỉ sau 3 ngày là vàng úa, chảy nước.\n• Bí quyết cực dễ: Rửa sạch hành lá rồi dùng khăn giấy thấm thật khô nước.\n• Cắt nhỏ vừa ăn, cho toàn bộ vào một chiếc chai nhựa sạch và khô ráo.\n• Đậy kín nắp và để thẳng vào ngăn đá tủ lạnh, mỗi lần nấu chỉ cần lắc nhẹ là hành tơi rời từng miếng.',
            cta: 'Lưu ngay video này lại để dùng dần và Follow mình để biết thêm mẹo bếp hay nhé!',
            hashtags: '#meovatnhabep #meohay #cuocsonghangngay #reelsvn #naunuong'
        },
        {
            id: 'tpl-2',
            category: 'humor',
            title: 'Quy trình đi ngủ của hội cú đêm',
            duration: '22s',
            viralScore: '99%',
            hook: 'Tôi lúc 10 giờ tối: Hôm nay nhất định phải ngủ sớm để giữ gìn nhan sắc!',
            body: '• 22:15 tắt đèn, đắp chăn ngay ngắn, nhắm mắt quyết tâm đi vào giấc ngủ.\n• 22:30 chợt nhớ ra chưa check tin nhắn, mở điện thoại tự nhủ lướt đúng 5 phút thôi.\n• 01:45 sáng mắt vẫn mở to, xem từ video nấu ăn đêm đến drama showbiz không sót tập nào.\n• 06:30 sáng báo thức reo vang, ngồi thẫn thờ trên giường tự hứa tối nay sẽ ngủ sớm.',
            cta: 'Có ai tối qua cũng vừa trải qua kịch bản y hệt thế này không? Điểm danh dưới bình luận đi!',
            hashtags: '#cudam #haihuoc #doithuong #reelsvietnam #xuhuong'
        },
        {
            id: 'tpl-3',
            category: 'vlog',
            title: 'Cầm 50k đi chợ nấu mâm cơm 2 người',
            duration: '28s',
            viralScore: '96%',
            hook: 'Chỉ với 50 nghìn đồng trong túi, liệu có nấu được một mâm cơm đủ chất cho 2 người ăn?',
            body: '• Sáng sớm ghé chợ cóc đầu ngõ với đúng tờ 50 nghìn lẻ trong ví.\n• Mua 25 nghìn thịt ba rọi thái mỏng, 10 nghìn rau muống tươi và 10 nghìn đậu hũ non.\n• Còn dư 5 nghìn mua thêm hành lá và tỏi để phi thơm dậy mùi cả căn bếp nhỏ.\n• Chỉ 20 phút vào bếp đã có ngay mâm cơm nóng hổi: thịt rang cháy cạnh, đậu sốt cà và canh rau.',
            cta: 'Tính ra mỗi người chỉ tốn 25 nghìn mà no căng bụng. Bạn chấm mâm cơm này mấy điểm?',
            hashtags: '#comnha #50k #minivlog #tietkiem #cuocsongsinhvien'
        },
        {
            id: 'tpl-4',
            category: 'lifehack',
            title: 'Cách gấp áo thun siêu gọn trong 3 giây',
            duration: '22s',
            viralScore: '95%',
            hook: 'Tủ quần áo nhà bạn luôn bừa bộn chỉ vì bạn chưa biết cách gấp áo thần tốc này!',
            body: '• Trải phẳng chiếc áo thun ra mặt giường, tưởng tượng một đường thẳng chia đôi chiều ngang áo.\n• Tay trái kẹp điểm giữa vai áo, tay phải kẹp điểm giữa thân áo trên cùng một đường thẳng.\n• Vắt chéo tay trái qua mép dưới gấu áo, kẹp chặt rồi nhấc bổng chiếc áo lên không trung.\n• Gập đôi xuống mặt bàn là xong ngay một chiếc áo vuông vức phẳng phiu như ngoài tiệm.',
            cta: 'Thử áp dụng ngay tối nay nhé, thấy dễ thì thả tim và Follow ủng hộ mình nha!',
            hashtags: '#gapquanao #dondepnhacua #lifehack #meovatcuocsong #reelsvn'
        },
        {
            id: 'tpl-5',
            category: 'humor',
            title: 'Những câu nói dối kinh điển của bản thân',
            duration: '24s',
            viralScore: '97%',
            hook: 'Top 3 câu nói dối kinh điển mà ngày nào chúng ta cũng tự lừa chính mình!',
            body: '• Câu số 1: Tháng này nhất định phải thắt chặt chi tiêu, không đặt hàng online nữa.\n• Nhưng vừa lướt thấy mã giảm giá nửa đêm là tay tự động bấm thanh toán lúc nào không hay.\n• Câu số 2: Từ ngày mai sẽ bắt đầu ăn kiêng và tập thể dục đều đặn mỗi chiều.\n• Câu số 3: Chợp mắt thêm đúng 5 phút nữa thôi rồi dậy, và kết quả là trễ giờ làm luôn.',
            cta: 'Bạn dính bao nhiêu câu trong số này rồi? Comment thật lòng bên dưới nhé!',
            hashtags: '#noidoi #tamsu #haihuocdoithuong #genz #reelsvietnam'
        },
        {
            id: 'tpl-6',
            category: 'vlog',
            title: 'Dọn lại góc bàn làm việc bừa bộn sau 1 tháng',
            duration: '26s',
            viralScore: '94%',
            hook: 'Nhìn góc bàn làm việc này chắc không ai tin đây là chỗ ngồi của một người yêu cái đẹp!',
            body: '• Sau một tháng chạy deadline liên tục, dây sạc, giấy note và cốc cà phê chất đầy mặt bàn.\n• Bắt tay dọn dẹp bằng cách gom toàn bộ đồ linh tinh ra ngoài và lau sạch bụi bẩn.\n• Dùng dây rút cố định gọn gàng đống dây điện rối rắm dưới gầm bàn.\n• Đặt thêm một chậu cây xanh nhỏ và bật chiếc đèn vàng ấm áp để lấy lại cảm hứng làm việc.',
            cta: 'Không gian gọn gàng giúp tâm trí nhẹ nhõm hơn hẳn. Cuối tuần này bạn nhớ dọn góc nhỏ của mình nhé!',
            hashtags: '#cleanup #goccanhan #chualanh #dailyvlog #decorphong'
        },
        {
            id: 'tpl-7',
            category: 'bts',
            title: 'Sự thật đằng sau một bức ảnh sống ảo',
            duration: '22s',
            viralScore: '96%',
            hook: 'Đừng vội ghen tị với những bức ảnh chill lung linh trên mạng cho đến khi bạn thấy cảnh này!',
            body: '• Trên mạng là góc cà phê ban công ngập nắng, bình yên như đang đi nghỉ dưỡng.\n• Thực tế đằng sau ống kính là cả một đống đồ đạc phải dồn hết sang một góc khuất.\n• Phải chụp liên tục hơn 50 tấm và chỉnh sáng tối đủ kiểu mới chọn được đúng một tấm ưng ý.\n• Đằng sau sự lung linh luôn là cả một quá trình sắp đặt đầy mồ hôi của hội đam mê chụp ảnh.',
            cta: 'Ai từng bắt bạn thân chụp 100 tấm mới lấy được 1 tấm thì tag ngay vào đây nhé!',
            hashtags: '#songao #hautruong #suthat #chupanhdep #reelsvn'
        },
        {
            id: 'tpl-8',
            category: 'lifehack',
            title: 'Khử mùi hôi giày dép chỉ bằng 2 túi trà lọc',
            duration: '23s',
            viralScore: '95%',
            hook: 'Đừng vội vứt bỏ túi trà lọc sau khi uống, vì nó là khắc tinh số 1 của mùi hôi giày!',
            body: '• Giày đi cả ngày dễ bị ẩm ướt và ám mùi khó chịu, nhất là vào những ngày trời mưa.\n• Hãy giữ lại 2 túi trà lọc đã qua sử dụng và phơi thật khô dưới ánh nắng.\n• Đặt trực tiếp vào bên trong mũi giày và để qua đêm để lá trà hút sạch hơi ẩm.\n• Sáng hôm sau lấy ra, đôi giày của bạn sẽ khô ráo và thoang thoảng hương trà cực dễ chịu.',
            cta: 'Mẹo nhỏ nhưng cực kỳ hiệu quả, lưu lại ngay để áp dụng cho cả nhà nhé!',
            hashtags: '#khumuigiay #meohaymoingay #tietkiem #lifehackvn #reels'
        },
        {
            id: 'tpl-9',
            category: 'vlog',
            title: 'Một buổi sáng dậy sớm lúc 5h30 của mình',
            duration: '27s',
            viralScore: '93%',
            hook: 'Thử dậy sớm hơn thường ngày 1 tiếng đồng hồ và cái kết khiến mình bất ngờ!',
            body: '• 05:30 sáng thức dậy khi phố xá vẫn còn yên tĩnh và không khí mát lành dễ chịu.\n• Uống một ly nước ấm, mở cửa sổ đón nắng sớm và dành 15 phút giãn cơ nhẹ nhàng.\n• Tự tay pha một ly cà phê thơm lừng và chuẩn bị bữa sáng thong thả không vội vàng.\n• Cảm giác làm chủ được thời gian buổi sáng giúp cả ngày làm việc tràn đầy năng lượng tích cực.',
            cta: 'Sáng nay bạn thức dậy lúc mấy giờ? Bình luận bên dưới để cùng tạo động lực dậy sớm nhé!',
            hashtags: '#daysom #morningroutine #nangluongtichcuc #vloghangngay #songxanh'
        },
        {
            id: 'tpl-10',
            category: 'humor',
            title: 'Tâm trạng ngày nhận lương vs cuối tháng',
            duration: '22s',
            viralScore: '98%',
            hook: 'Sự khác biệt một trời một vực giữa ngày mùng 5 nhận lương và ngày 25 cuối tháng!',
            body: '• Ngày mùng 5 ting ting nhận lương: Đi ăn nhà hàng không cần nhìn cột giá bên phải.\n• Sẵn sàng mời đồng nghiệp trà sữa và tự thưởng cho bản thân đủ món đồ yêu thích.\n• Ngày 25 cuối tháng: Mở tủ lạnh lục tìm từng gói mì tôm và đếm từng đồng tiền lẻ.\n• Chuyển sang chế độ ăn uống thanh đạm và đếm ngược từng giờ chờ tới kỳ lương tiếp theo.',
            cta: 'Hiện tại ví tiền của bạn đang ở trạng thái mùng 5 hay ngày 25 rồi? Comment ngay nhé!',
            hashtags: '#nhanluong #cuoithang #danvanphong #haihuoc #reelsvn'
        },
        {
            id: 'tpl-11',
            category: 'bts',
            title: 'Góc khuất nghề sáng tạo nội dung tại nhà',
            duration: '25s',
            viralScore: '94%',
            hook: 'Nhiều người nghĩ quay video ngắn tại nhà nhàn hạ lắm, nhưng đây mới là sự thật!',
            body: '• Để có một video 30 giây mượt mà, nhiều khi phải quay đi quay lại cả chục lần vì vấp thoại.\n• Đang quay đến đoạn hay thì tiếng xe cộ ngoài đường hoặc tiếng rao lại vang lên.\n• Ngồi hàng giờ liền để cắt ghép từng khung hình và chỉnh sửa phụ đề sao cho dễ đọc nhất.\n• Nhưng chỉ cần đọc được một bình luận khen hữu ích là bao nhiêu mệt mỏi đều tan biến hết.',
            cta: 'Cảm ơn bạn đã luôn xem và ủng hộ kênh nhỏ của mình, bấm Follow để đồng hành cùng mình nhé!',
            hashtags: '#sangtaonoidung #reelscreator #tamsu #behindthescenes #dongluc'
        },
        {
            id: 'tpl-12',
            category: 'lifehack',
            title: 'Cách bóc tỏi siêu nhanh không cay mắt',
            duration: '23s',
            viralScore: '97%',
            hook: 'Bỏ ngay cách ngồi bóc từng tép tỏi vừa đau móng tay vừa ám mùi suốt cả ngày đi!',
            body: '• Mỗi lần nấu ăn phải bóc cả củ tỏi bằng tay vừa mất thời gian lại vừa xót đầu ngón tay.\n• Bạn chỉ cần tách rời các tép tỏi rồi cho tất cả vào một chiếc lọ thủy tinh có nắp đậy.\n• Đậy kín nắp và dùng hai tay lắc thật mạnh lọ thủy tinh trong khoảng 15 giây.\n• Mở nắp ra, lớp vỏ tỏi đã tự động bong tróc sạch sẽ, lộ ra những tép tỏi trắng tinh.',
            cta: 'Quá nhanh và tiện lợi phải không nào? Lưu ngay mẹo bếp này về dùng nhé!',
            hashtags: '#meonhabep #boctoi #nauanngon #lifehack #reelsvietnam'
        },
        {
            id: 'tpl-13',
            category: 'lifehack',
            title: 'Cài đặt điện thoại đỡ tốn pin gấp đôi',
            duration: '26s',
            viralScore: '97%',
            hook: 'Pin điện thoại tụt không phanh dù mới sạc đầy? Hãy tắt ngay 3 mục ẩn này đi!',
            body: '• Vào Cài đặt và tắt làm mới ứng dụng chạy ngầm cho những app ít khi mở đến.\n• Chuyển định vị của các app mua sắm sang chế độ chỉ dùng khi mở ứng dụng.\n• Tắt thông báo quảng cáo từ hàng chục app không cần thiết làm sáng màn hình liên tục.\n• Chỉ mất 30 giây chỉnh lại mà thời lượng pin dùng cả ngày dài hơn hẳn thấy rõ.',
            cta: 'Lưu ngay mẹo công nghệ này lại và gửi cho người hay than hết pin nhé!',
            hashtags: '#meocongnghe #tietkiempin #dienthoai #lifehackvn #reelsvn'
        },
        {
            id: 'tpl-14',
            category: 'vlog',
            title: 'Thử thách 1 ngày không tiêu quá 100k ở thành phố',
            duration: '29s',
            viralScore: '96%',
            hook: 'Liệu giữa thành phố đắt đỏ, có sống nổi trọn vẹn 1 ngày chỉ với đúng 100 nghìn đồng?',
            body: '• Bữa sáng tự pha cà phê tại nhà kèm bánh mì trứng chiên chỉ tốn khoảng 15 nghìn.\n• Trưa mang hộp cơm chuẩn bị từ tối hôm trước đi làm, tiết kiệm nguyên một suất cơm văn phòng.\n• Chiều tan làm ghé chợ mua bó rau và vài quả trứng để nấu bữa tối ấm cúng hết 40 nghìn.\n• Tổng kết cả ngày vẫn dư tiền bỏ ống heo mà ăn uống vẫn đủ chất, sạch sẽ.',
            cta: 'Kỷ lục chi tiêu tiết kiệm nhất 1 ngày của bạn là bao nhiêu? Kể dưới bình luận nhé!',
            hashtags: '#tietkiem #100k #taichinhcanhan #minivlog #songtoigian'
        },
        {
            id: 'tpl-15',
            category: 'humor',
            title: 'Khi mẹ bảo dọn phòng cho gọn vào',
            duration: '23s',
            viralScore: '98%',
            hook: 'Đừng bao giờ hỏi mẹ đồ của con để đâu sau khi mẹ vừa giúp bạn dọn phòng!',
            body: '• Trước khi dọn: Cả căn phòng nhìn hơi bừa nhưng nhắm mắt cũng biết cái sạc ở góc nào.\n• Sau khi mẹ ra tay: Mặt bàn bóng loáng, quần áo thẳng tắp nhìn cứ như phòng mẫu khách sạn.\n• Vấn đề duy nhất là đi tìm cái tai nghe mất nguyên 20 phút vẫn không thấy tăm hơi.\n• Cuối cùng lại phải chạy xuống bếp hỏi mẹ và câu trả lời luôn là ở chỗ dễ thấy nhất.',
            cta: 'Ai từng mất tích đồ đạc sau mỗi lần mẹ tổng vệ sinh thì thả tim ngay nha!',
            hashtags: '#mevacon #donphong #haihuocgiadinh #doithuong #reelsvn'
        },
        {
            id: 'tpl-16',
            category: 'bts',
            title: 'Bí mật khiến ảnh đồ ăn nhìn ngon gấp 10 lần',
            duration: '24s',
            viralScore: '95%',
            hook: 'Tại sao cùng một đĩa cơm nhà mà người ta chụp nhìn như nhà hàng, còn mình chụp lại tối om?',
            body: '• Lỗi số 1 là đứng chụp ngay dưới ánh đèn tuýp trên trần khiến bóng điện thoại đổ thẳng xuống đĩa.\n• Bí quyết cực đơn giản: Bê đĩa đồ ăn ra sát cửa sổ có ánh sáng tự nhiên chiếu ngang.\n• Đặt góc máy nghiêng 45 độ và chạm vào màn hình để khóa nét vào phần món chính.\n• Thêm một đôi đũa hoặc cốc nước đặt hờ bên cạnh là khung hình có chiều sâu ngay lập tức.',
            cta: 'Bữa tối nay thử áp dụng ngay góc chụp này rồi khoe thành quả nhé!',
            hashtags: '#chupanhdoan #foodphotography #meochupanh #hautruong #reels'
        },
        {
            id: 'tpl-17',
            category: 'lifehack',
            title: 'Làm sạch đáy chảo cháy đen không cần cọ sắt',
            duration: '25s',
            viralScore: '97%',
            hook: 'Chảo chống dính bị cháy đen xì đừng vội vứt đi, thử ngay hỗn hợp 3 món có sẵn trong bếp!',
            body: '• Rắc một lớp baking soda phủ đều lên phần đáy chảo bị bám cặn cháy cứng đầu.\n• Đổ thêm một ít nước rửa chén rồi đặt lên trên vài tờ khăn giấy ăn.\n• Xịt hoặc rưới giấm trắng lên mặt giấy cho thấm đẫm rồi chờ khoảng 15 phút.\n• Lột lớp giấy ra và lau nhẹ bằng miếng bọt biển, vết cháy tự bong tróc sáng bóng.',
            cta: 'Lưu lại để cuối tuần dọn bếp cực nhàn mà không làm xước chảo nhé!',
            hashtags: '#vesinhnhabep #meovatgiadinh #donnha #lifehack #reelsvn'
        },
        {
            id: 'tpl-18',
            category: 'vlog',
            title: 'Chủ nhật reset lại năng lượng cho tuần mới',
            duration: '28s',
            viralScore: '94%',
            hook: 'Thay vì nằm lướt điện thoại hết Chủ nhật rồi hoảng hốt tối khuya, hãy thử lịch trình này!',
            body: '• Buổi sáng thay bộ ga gối mới thơm tho và mở rèm cho nắng gió lùa khắp phòng.\n• Trưa đi siêu thị mua sẵn rau củ, sơ chế chia hộp cho 3 ngày đầu tuần bận rộn.\n• Buổi chiều dành 1 tiếng đọc sách hoặc đi bộ hít thở không khí công viên.\n• Tối viết nhanh 5 đầu việc ưu tiên cho thứ Hai để sáng mai thức dậy thật nhẹ đầu.',
            cta: 'Chủ nhật bạn thường làm gì để sạc lại pin cho tuần mới? Chia sẻ cùng mình nhé!',
            hashtags: '#sundayreset #songtichcuc #chualanh #dailyvlog #nangluongmoi'
        },
        {
            id: 'tpl-19',
            category: 'humor',
            title: 'Nỗi khổ của người hướng nội khi đi cắt tóc',
            duration: '22s',
            viralScore: '98%',
            hook: 'Khoảnh khắc căng thẳng nhất của người hướng nội không phải phỏng vấn mà là ngồi ghế cắt tóc!',
            body: '• Đưa mẫu tóc trong điện thoại xong chỉ biết cầu nguyện kết quả giống được 70 phần trăm.\n• Thợ hỏi "cắt ngắn cỡ này được chưa em?" dù thấy hơi ngắn rồi vẫn gật đầu "dạ ổn ạ".\n• Thợ gợi chuyện hỏi quê quán công việc là mồ hôi tự nhiên túa ra dù máy lạnh 18 độ.\n• Lúc tính tiền còn cảm ơn rối rít rồi về nhà mới dám soi gương thở dài.',
            cta: 'Đồng cảm 100% thì cho xin một bình luận điểm danh hội hướng nội nào!',
            hashtags: '#huongnoi #cattoc #haihuoc #genz #reelsvietnam'
        },
        {
            id: 'tpl-20',
            category: 'bts',
            title: 'Một chiếc Reel 30 giây tốn bao nhiêu thời gian làm?',
            duration: '26s',
            viralScore: '95%',
            hook: 'Bạn lướt qua video này chỉ mất 3 giây, nhưng để làm xong nó mình đã mất gần nửa buổi!',
            body: '• 20 phút ngồi nghĩ câu mở đầu sao cho đúng tâm lý người xem không bị lướt qua.\n• 30 phút tìm góc ánh sáng ổn định và thu đi thu lại phần giọng đọc cho rõ ràng.\n• 45 phút cắt bỏ từng khoảng thở thừa để nhịp video nhanh gọn, không bị chán.\n• Thêm 15 phút căn chỉnh phụ đề chữ to rõ ràng cho người xem tắt tiếng vẫn hiểu.',
            cta: 'Nếu thấy video chỉn chu, đừng tiếc 1 tim tiếp thêm động lực cho người làm nội dung nhé!',
            hashtags: '#creator #sangtaonoidung #hauky #reelsvn #tamsu'
        },
        {
            id: 'tpl-21',
            category: 'lifehack',
            title: 'Mẹo giúp quần áo phơi ngày mưa không bị mùi ẩm',
            duration: '24s',
            viralScore: '96%',
            hook: 'Trời nồm ẩm phơi quần áo 3 ngày không khô lại còn bốc mùi? Thử ngay mẹo nhỏ này!',
            body: '• Khi giũ quần áo xong, trải phẳng lên một chiếc khăn bông khô lớn rồi cuộn tròn lại.\n• Ấn nhẹ hoặc vặn nhẹ cuộn khăn trong 30 giây để khăn hút bớt lượng nước thừa.\n• Treo quần áo cách nhau tối thiểu 5 phân và bật quạt thổi nhẹ góc phòng.\n• Quần áo khô nhanh gấp đôi bình thường và giữ trọn mùi nước xả thơm dịu.',
            cta: 'Mùa mưa sắp tới rồi, lưu ngay bí quyết này cho cả gia đình dùng nhé!',
            hashtags: '#meogiatgiu #troimua #quanaothomtho #lifehack #reelsvn'
        },
        {
            id: 'tpl-22',
            category: 'vlog',
            title: '30 phút buổi tối giúp ngủ sâu hơn hẳn',
            duration: '27s',
            viralScore: '95%',
            hook: 'Nếu bạn hay trằn trọc tới 1 giờ sáng mới ngủ được, hãy thử chuỗi thói quen 30 phút này!',
            body: '• Đặt điện thoại ra xa giường ngủ trước giờ đi ngủ ít nhất 20 phút.\n• Tắt đèn trần chói mắt, chỉ bật một ngọn đèn ngủ ánh vàng dịu nhẹ.\n• Pha một tách trà hoa cúc ấm hoặc ngâm chân nước ấm trong lúc nghe nhạc không lời.\n• Viết ra giấy 1 điều làm bạn thấy biết ơn hôm nay để tâm trí hoàn toàn thư giãn.',
            cta: 'Tối nay thử bỏ điện thoại sớm hơn 20 phút cùng mình nhé! Follow để xem thêm mẹo sống khỏe.',
            hashtags: '#ngungon #nightroutine #chamsocbanthan #songkhoe #minivlog'
        },
        {
            id: 'tpl-23',
            category: 'humor',
            title: 'Chuyện đi siêu thị lúc đang đói bụng',
            duration: '22s',
            viralScore: '97%',
            hook: 'Quy tắc sinh tồn số 1: Tuyệt đối không bao giờ bước chân vào siêu thị khi bụng đang đói!',
            body: '• Lúc ở nhà lên danh sách rõ ràng: Chỉ mua đúng 1 chai dầu ăn và 1 vỉ sữa.\n• Vừa đẩy xe ngang quầy bánh mì nóng giòn là lý trí tự động sụp đổ ngay lập tức.\n• Tay gắp thêm gói snack, hộp kem, xúc xích và hai chai trà sữa đóng chai.\n• Ra quầy thu ngân nhìn hóa đơn gấp 4 lần dự kiến mà vẫn ngơ ngác không hiểu tại sao.',
            cta: 'Có ai cũng toàn mua cả siêu thị về mỗi khi đi mua đồ lúc đói không?',
            hashtags: '#disieuthi #anuong #haihuocdoithuong #tietkiem #reelsvn'
        },
        {
            id: 'tpl-24',
            category: 'lifehack',
            title: 'Cách làm mát phòng nhanh không cần bật điều hòa cả đêm',
            duration: '25s',
            viralScore: '96%',
            hook: 'Tiền điện mùa nóng tăng vọt? Thử ngay mẹo làm mát phòng cực nhanh này!',
            body: '• Ban ngày đóng kín rèm cửa sổ hướng nắng để hạn chế hơi nóng tích tụ trong phòng.\n• Chiều tối mở hai cửa đối diện nhau và đặt quạt hướng ra ngoài để đẩy khí nóng ra trước.\n• Sau 10 phút khi phòng đã thoáng, đặt một chậu nước đá nhỏ trước quạt rồi bật chế độ xoay.\n• Nhiệt độ phòng giảm rõ rệt mà tiền điện cuối tháng nhẹ nhàng hơn rất nhiều.',
            cta: 'Áp dụng thử ngay tối nay và kiểm tra hóa đơn điện tháng sau xem sao nhé!',
            hashtags: '#tietkiendien #muanong #meonhacua #lifehackvn #reels'
        },
        {
            id: 'tpl-25',
            category: 'bts',
            title: 'Vì sao video quay bằng điện thoại thường vẫn lên triệu view?',
            duration: '26s',
            viralScore: '97%',
            hook: 'Đừng chờ mua máy ảnh xịn mới dám làm video, vì 90% Reels triệu view đều quay bằng điện thoại!',
            body: '• Người xem lướt mạng tìm sự chân thật và hữu ích chứ không chấm điểm độ nét 8K.\n• Chỉ cần lau sạch ống kính camera trước khi bấm quay là hình đã trong trẻo hơn hẳn.\n• Đứng gần cửa sổ có ánh sáng tự nhiên và kê điện thoại cố định bằng chồng sách.\n• Thứ quyết định giữ chân người xem chính là câu chuyện gần gũi và âm thanh rõ ràng.',
            cta: 'Bắt đầu quay video đầu tiên của bạn ngay hôm nay nhé! Follow mình để học thêm mẹo làm Reels.',
            hashtags: '#lamreels #quayvideo #dienthoai #sangtaonoidung #reelsvn'
        },
        {
            id: 'tpl-26',
            category: 'vlog',
            title: 'Bữa trưa văn phòng tự nấu mang đi trong 15 phút',
            duration: '26s',
            viralScore: '95%',
            hook: 'Chán cảnh trưa nào cũng đau đầu nghĩ "hôm nay ăn gì", mình chuyển sang tự nấu chỉ mất 15 phút!',
            body: '• Sáng dậy cắm nồi cơm điện trước, trong lúc chờ cơm chín thì rửa sạch rau và ướp ức gà.\n• Áp chảo nhanh miếng gà vàng ươm hai mặt cùng chút tỏi băm thơm nức mũi.\n• Chần sơ bông cải xanh và cà rốt trong 2 phút để giữ trọn màu xanh giòn ngọt.\n• Xếp gọn vào hộp thủy tinh, vừa sạch sẽ đảm bảo sức khỏe lại tiết kiệm cả triệu mỗi tháng.',
            cta: 'Hôm nay bữa trưa của bạn có món gì ngon? Bình luận cho mình tham khảo thực đơn nhé!',
            hashtags: '#comvanphong #mealprep #healthy #minivlog #tietkiem'
        },
        {
            id: 'tpl-27',
            category: 'humor',
            title: 'Kịch bản quen thuộc mỗi khi mở tủ lạnh',
            duration: '21s',
            viralScore: '98%',
            hook: 'Khoa học chưa giải thích nổi tại sao chúng ta có thể mở tủ lạnh 5 lần trong 10 phút dù biết không có gì!',
            body: '• Lần 1 mở ra: Thấy mỗi chai nước lọc và quả chanh khô, đóng cửa tủ đi ra.\n• Lần 2 mở ra sau 3 phút với hy vọng thần kỳ nào đó đồ ăn ngon sẽ tự xuất hiện.\n• Lần 3 mở ra đứng nhìn chằm chằm 30 giây như đang suy tư về ý nghĩa cuộc sống.\n• Cuối cùng vẫn lấy đúng chai nước lọc ra uống rồi đóng tủ lạnh cái rầm.',
            cta: 'Thừa nhận đi, hôm nay bạn đã mở tủ lạnh bao nhiêu lần rồi?',
            hashtags: '#tulanh #haihuoc #genz #cuocsonghangngay #reelsvietnam'
        },
        {
            id: 'tpl-28',
            category: 'lifehack',
            title: '3 thói quen giúp bàn phím & màn hình laptop luôn sạch như mới',
            duration: '24s',
            viralScore: '94%',
            hook: 'Màn hình laptop đầy dấu vân tay và bụi bẩn? Đừng bao giờ xịt nước lau kính trực tiếp lên nhé!',
            body: '• Nước lau kính có cồn mạnh dễ làm bong lớp phủ chống lóa trên màn hình máy tính.\n• Hãy dùng khăn microfiber mềm thấm nhẹ nước cất hoặc dung dịch chuyên dụng rồi lau một chiều.\n• Dùng cọ trang điểm cũ hoặc giấy nhớ lướt nhẹ qua kẽ phím để lấy sạch bụi vụn.\n• Mỗi tuần lau nhanh 2 phút giúp máy bền đẹp và gõ phím sướng tay hơn hẳn.',
            cta: 'Lưu lại ngay để bảo vệ chiếc laptop đồng hành kiếm tiền của bạn nhé!',
            hashtags: '#laptop #vesinhmaytinh #congnghe #meohay #reelsvn'
        },
        {
            id: 'tpl-29',
            category: 'bts',
            title: 'Cách đặt tiêu đề khiến người xem phải bấm dừng lại',
            duration: '25s',
            viralScore: '98%',
            hook: 'Nội dung hay mấy mà mở đầu chán thì cũng ế view! Đây là 3 công thức mở đầu cực dính:',
            body: '• Công thức 1 — Cảnh báo sai lầm: "Đừng làm X nữa nếu bạn không muốn gặp Y!".\n• Công thức 2 — Con số cụ thể: "Chỉ với 50k và 15 phút để làm xong món này tại nhà".\n• Công thức 3 — Sự thật đối lập: "Ai cũng nghĩ cách này khó, cho tới khi thấy bước thứ 2".\n• Đưa chữ to rõ vào giữa trên của video để người xem đọc trúng ngay trong 1 giây đầu.',
            cta: 'Lưu ngay 3 công thức Hook này về dùng cho video tiếp theo của bạn nhé!',
            hashtags: '#vietkichban #hook3s #tangview #reelsvietnam #kinhnghiem'
        },
        {
            id: 'tpl-30',
            category: 'vlog',
            title: 'Chiều cuối tuần tự thưởng một ly trà trái cây tại nhà',
            duration: '25s',
            viralScore: '94%',
            hook: 'Thay vì ra quán tốn 60 nghìn một ly nước, cuối tuần này thử tự pha trà đào cam sả chuẩn vị tại nhà!',
            body: '• Ủ hai túi trà đen với nước sôi khoảng 5 phút rồi để nguội tự nhiên giữ hương thơm.\n• Cắt vài lát cam tươi, đập dập một nhánh sả cho vào bình lắc cùng đá viên và chút mật ong.\n• Rót phần trà ra ly cao, xếp thêm vài miếng đào ngâm giòn sần sật lên trên.\n• Chỉ 5 phút pha chế đã có ngay ly trà mát lạnh thơm lừng ngồi chill đọc sách cả buổi chiều.',
            cta: 'Cuối tuần bạn thích ở nhà tự pha đồ uống hay ra quán cà phê hơn? Comment bên dưới nhé!',
            hashtags: '#phache #tradaocamsa #cuoituan #chill #minivlog'
        }
    ];
})(window);
