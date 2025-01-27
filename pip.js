const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');

class Pip {
    constructor() {
        this.baseHeaders = {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://tg.pip.world",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        this.config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    }

    getHeaders(initData) {
        return {
            ...this.baseHeaders,
            "Authorization": initData
        };
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [*] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [!] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [*] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [*] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`===== Chờ ${i} giây để tiếp tục vòng lặp =====`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async refillEnergy(headers) {
        const refillUrl = "https://api.tg.pip.world/app/post/activateFreeRefillEnergy";
        try {
            const refillResponse = await axios.post(refillUrl, {}, { headers });
            if (refillResponse.status === 200) {
                const user = refillResponse.data.user;
                this.log('Nạp năng lượng thành công', 'success');
                this.log(`Energy: ${user.energy}/${user.maxUserEnergy}`, 'custom');
                this.log(`Lượt nạp năng lượng còn: ${user.freeEnergyRefills.available}`, 'custom');
                return user;
            }
        } catch (error) {
            this.log(`Lỗi khi nạp năng lượng: ${error.message}`, 'error');
        }
        return null;
    }

    async buyInvestItem(headers, itemId, itemPrice, userBalance) {
        const buyUrl = "https://api.tg.pip.world/app/post/buyInvestItem";
        try {
            const buyResponse = await axios.post(buyUrl, { itemId }, { headers });
            
            if (buyResponse.status === 200) {
                const user = buyResponse.data.user;
                this.log(`Nâng cấp thành công thẻ: ${itemId} | New balance: ${user.balance}`, 'success');
                return user;
            }
        } catch (error) {
            this.log(`Lỗi khi mua item ${itemId}: ${error.message}`, 'error');
            return false;
        }
        return false;
    }
    
    async upgradeCards(headers, user, initData) {
        const loginUrl = "https://api.tg.pip.world/app/post/login25";
        
        const loginPayload = {
            initData: initData,
            referredBy: JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0])).id
        };

        const loginResponse = await axios.post(loginUrl, loginPayload, { headers });
        const availableInvestItems = loginResponse.data.investItems?.investItems || [];
        const userInvestItems = user.investItems || [];
        const boughtItemIds = new Set(userInvestItems.map(item => item.id));
        
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        for (const item of availableInvestItems) {
            if (boughtItemIds.has(item.id)) {
                this.log(`Thẻ ${item.id} đã mua rồi, skipping`, 'info');
                continue;
            }

            if (item.validUntil && currentTimestamp > item.validUntil) {
                this.log(`Thẻ ${item.id} đã hết hạn (${new Date(item.validUntil * 1000).toLocaleString()}), bỏ qua`, 'warning');
                continue;
            }

            this.log(`Thẻ ${item.id} | Price: ${item.price} | Profit: ${item.profitPerHour}`, 'info');
            
            if (user.balance > item.price && item.price <= this.config.maxInvestPrice) {
                const buyResult = await this.buyInvestItem(headers, item.id, item.price, user.balance);
                if (buyResult === false) {
                    this.log(`Không thể nâng cấp thẻ: ${item.id}`, 'warning');
                    continue;
                }
                user = buyResult;
            }
        }

        return user;
    }

    async getQuestIds(loginResponse) {
        const quests = loginResponse.data.quests?.quests || [];
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        return quests
            .filter(quest => 
                !quest.completed && 
                (quest.validUntil === null || currentTimestamp <= quest.validUntil)
            )
            .map(quest => quest.id);
    }

    async checkAndCompleteQuests(headers, questIds) {
        const checkQuestUrl = "https://api.tg.pip.world/app/post/checkQuest";
        
        for (const questId of questIds) {
            try {
                const checkResponse = await axios.post(checkQuestUrl, { questId }, { headers });
                
                if (checkResponse.status === 200) {
                    const quests = checkResponse.data.quests?.quests;
                    if (quests) {
                        const quest = quests.find(q => q.id === questId);
                        if (quest) {
                            this.log(`Nhiệm vụ ${quest.title} đã hoàn thành | Phần thưởng ${quest.reward}`, 'success');
                        } else {
                            this.log(`Không tìm thấy nhiệm vụ với ID ${questId}`, 'info');
                        }
                    } else {
                        this.log(`Không có nhiệm vụ nào trong phản hồi`, 'info');
                    }
                } else {
                    this.log(`Phản hồi không mong đợi khi kiểm tra nhiệm vụ ${questId}: ${checkResponse.status}`, 'warning');
                }
            } catch (error) {
                if (error.response) {
                    if (error.response.status === 400) {
                        this.log(`Nhiệm vụ ${questId} không hợp lệ hoặc đã hết hạn`, 'warning');
                    } else {
                        this.log(`Lỗi khi kiểm tra nhiệm vụ ${questId}: ${error.response.status} - ${error.response.data}`, 'error');
                    }
                } else {
                    this.log(`Lỗi khi kiểm tra nhiệm vụ ${questId}: ${error.message}`, 'error');
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }    

    async loginAndUpdateUser(initData) {
        const loginUrl = "https://api.tg.pip.world/app/post/login25";
        const passiveIncomeUrl = "https://api.tg.pip.world/app/get/yieldpassiveincome";
        const updateTradingGroupUrl = "https://api.tg.pip.world/app/patch/updateUserTradingGroup";
        const boardingCompletedUrl = "https://api.tg.pip.world/app/post/boardingCompleted";
        const headers = this.getHeaders(initData);
    
        try {
            const loginPayload = {
                initData: initData,
                referredBy: "376905749" //ref code
            };
    
            const loginResponse = await axios.post(loginUrl, loginPayload, { headers });
            
            if (loginResponse.status === 200) {
                this.log('Đăng nhập thành công!', 'success');
                let user = loginResponse.data.user;
                this.log(`Balance: ${user.balance}`, 'info');
    
                if (!user.boardingCompleted) {
                    const groupId = Math.floor(Math.random() * 4) + 1;
                    
                    const updateGroupResponse = await axios.patch(updateTradingGroupUrl, { groupId: groupId.toString() }, { headers });
                    
                    if (updateGroupResponse.status === 200) {
                        const groupName = updateGroupResponse.data.user.tradingGroupData.name;
                        this.log(`Bạn đã chọn nhóm ${groupName}`, 'success');
                        
                        const boardingCompletedResponse = await axios.post(boardingCompletedUrl, {}, { headers });
                        
                        if (boardingCompletedResponse.status === 200) {
                            this.log('Hoàn thành quá trình boarding', 'success');
                            user = boardingCompletedResponse.data.user;
                        }
                    }
                }
    
                const questIds = await this.getQuestIds(loginResponse);
                await this.checkAndCompleteQuests(headers, questIds);
    
                const passiveIncomeResponse = await axios.get(passiveIncomeUrl, { headers });
    
                if (passiveIncomeResponse.status === 200) {
                    user = passiveIncomeResponse.data.user;
    
                    user = await this.performTaps(headers, user);
                    user = await this.upgradeCards(headers, user, initData);
                }
            }
        } catch (error) {
            this.log(`Lỗi trong loginAndUpdateUser: ${error.message}`, 'error');
            console.error(error);
        }
    }

    async activateFreeTapsMultiplier(headers) {
        const activateUrl = "https://api.tg.pip.world/app/post/activateFreeTapsMultiplier";
        try {
            const activateResponse = await axios.post(activateUrl, {}, { headers });
            if (activateResponse.status === 200) {
                const user = activateResponse.data.user;
                return user;
            }
        } catch (error) {
            this.log(`Lỗi kích hoạt tap boost: ${error.message}`, 'error');
        }
        return null;
    }

    async performTaps(headers, user) {
        const tapHandlerUrl = "https://api.tg.pip.world/app/post/tapHandler27";
        let isFirstTap = true;

        while (true) {
            let tapAmount = isFirstTap ? user.coinsPerTap : user.energy;

            if (tapAmount === 0) {
                this.log('Không còn năng lượng để tap', 'warning');
                break;
            }
            if (!isFirstTap && user.freeTapsMultiplier.available > 0) {
                const currentTime = Math.floor(Date.now() / 1000);
                if (currentTime > user.freeTapsMultiplier.lastTimeUpdated + 3600) {
                    const updatedUser = await this.activateFreeTapsMultiplier(headers);
                    if (updatedUser) {
                        user = updatedUser;
                        tapAmount = user.energy * 5;
                        this.log(`Đã kích hoạt Tap boost. Số lần tap được tăng cường: ${tapAmount}`, 'custom');
                    }
                }
            }

            const tapPayload = { coins: tapAmount };
            try {
                const tapResponse = await axios.post(tapHandlerUrl, tapPayload, { headers });
                
                if (tapResponse.status === 200) {
                    user = tapResponse.data.user;
                    this.log(`Tap thành công: ${tapAmount} coins`, 'success');
                    this.log(`Energy: ${user.energy}/${user.maxUserEnergy}`, 'custom');
                    this.log(`Balance: ${user.balance}`, 'custom');
                    this.log(`Full Energy: ${user.freeEnergyRefills.available}`, 'custom');
                    this.log(`Tap boosts: ${user.freeTapsMultiplier.available}`, 'custom');
                    isFirstTap = false;
                    
                    if (user.energy === 0 && user.freeEnergyRefills.available > 0) {
                        const refillResult = await this.refillEnergy(headers);
                        if (!refillResult) {
                            this.log('Không thể nạp lại năng lượng', 'warning');
                            break;
                        }
                        user = refillResult;
                    } else if (user.energy < 20) {
                        this.log('Hết năng lượng và không còn lượt nạp miễn phí', 'warning');
                        break;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    this.log('Tap failed', 'error');
                    break;
                }
            } catch (error) {
                this.log(`Error during tap: ${error.message}`, 'error');
                if (error.response) {
                    this.log(`Server responded with status: ${error.response.status}`, 'error');
                    this.log(`Response data: ${JSON.stringify(error.response.data)}`, 'error');
                }
                break;
            }
        }

        return user;
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        while (true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const firstName = userData.first_name;

                console.log(`========== Tài khoản ${i + 1} | ${firstName.green} ==========`);
                
                await this.loginAndUpdateUser(initData);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.countdown(5 * 60);
        }
    }
}

const client = new Pip();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});